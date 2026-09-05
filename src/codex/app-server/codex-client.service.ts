import { EventEmitter } from 'node:events';

import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';

import type { InitializeResponse } from '../protocol/generated/InitializeResponse';
import { CODEX_TRANSPORT, CodexTransport } from './codex-transport';
import { ServerRequestRegistry } from './server-request.registry';
import {
  WireClientResponse,
  WireInbound,
  WireResponse,
  WireServerNotification,
  WireServerRequest,
  classifyInbound,
} from './wire.types';

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const INITIALIZE_TIMEOUT_MS = 30_000;

/**
 * Prefix for internal listener keys.
 *
 * Codex sends a notification whose method is literally "error", and Node's
 * EventEmitter throws when an 'error' event is emitted with no listener — one
 * upstream error would take the whole gateway down. Namespacing keeps protocol
 * method names away from EventEmitter's reserved one.
 */
const EVENT_PREFIX = 'codex:';
const ANY_EVENT = 'codex:*';

const CLIENT_INFO = {
  name: 'codex-gateway',
  title: 'Codex Gateway',
  version: '0.1.0',
} as const;

export interface CodexClientStatus {
  connected: boolean;
  transport: string;
  /** Reported by the server, not guessed from our own environment. */
  codexHome: string | null;
  userAgent: string | null;
  platformOs: string | null;
  lastError: string | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

/** Thrown when the app-server answers one of our requests with an error. */
export class CodexRpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(`${method} failed (${code}): ${message}`);
    this.name = 'CodexRpcError';
  }
}

/**
 * Bidirectional client for the Codex app-server.
 *
 * Bidirectional from the start on purpose. Approvals arrive as server-initiated
 * requests that the app-server blocks on, so a one-way event stream would have
 * to be torn out again the moment approvals land in Phase 5. Everything above
 * this class deals in method names and typed payloads; nothing outside this
 * directory knows the wire envelope exists.
 */
@Injectable()
export class CodexClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CodexClientService.name);
  private readonly notifications = new EventEmitter();
  private readonly pending = new Map<number, PendingRequest>();

  private nextRequestId = 1;
  private connecting: Promise<void> | null = null;
  private connected = false;
  private shuttingDown = false;
  private initializeResponse: InitializeResponse | null = null;
  private lastError: string | null = null;

  constructor(
    @Inject(CODEX_TRANSPORT) private readonly transport: CodexTransport,
    private readonly serverRequests: ServerRequestRegistry,
  ) {
    this.notifications.setMaxListeners(0);
    this.transport.onMessage((message) => this.handleInbound(message));
    this.transport.onExit((exit) => this.handleExit(exit.code, exit.signal));
  }

  /**
   * Best-effort connect at boot. A failure is logged rather than thrown: the
   * HTTP API stays up, and /health is how an operator finds out what broke.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureReady();
    } catch (error) {
      this.logger.error(`Could not reach the Codex app-server: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    this.failAllPending(new Error('The gateway is shutting down'));
    await this.transport.close();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStatus(): CodexClientStatus {
    return {
      connected: this.connected,
      transport: this.transport.name,
      codexHome: this.initializeResponse?.codexHome ?? null,
      userAgent: this.initializeResponse?.userAgent ?? null,
      platformOs: this.initializeResponse?.platformOs ?? null,
      lastError: this.lastError,
    };
  }

  /**
   * Connects and completes the handshake if needed. Concurrent callers share a
   * single attempt, and a later call retries after a failure — which is what
   * brings the gateway back when app-server dies mid-life.
   */
  async ensureReady(): Promise<void> {
    if (this.connected) return;
    if (this.shuttingDown) throw new ServiceUnavailableException('The gateway is shutting down');
    if (this.connecting) return this.connecting;

    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  /** Calls a method and resolves with its typed result. */
  async request<TResult>(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<TResult> {
    await this.ensureReady();
    return this.dispatch<TResult>(method, params, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  }

  /**
   * Like request(), but reports an unreachable app-server as 503 instead of a
   * generic failure. "Codex is not running" is an operational condition, not a
   * bug in the gateway, and callers should not each re-derive that.
   */
  async requestOrUnavailable<TResult>(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<TResult> {
    try {
      return await this.request<TResult>(method, params, options);
    } catch (error) {
      if (!this.connected) {
        throw new ServiceUnavailableException('The Codex app-server is not reachable');
      }
      throw error;
    }
  }

  /** Sends a notification. Nothing comes back. */
  notify(method: string, params?: unknown): void {
    this.transport.send(params === undefined ? { method } : { method, params });
  }

  /** Subscribes to one server notification, e.g. account/login/completed. */
  on(method: string, listener: (params: unknown) => void): () => void {
    const key = EVENT_PREFIX + method;
    this.notifications.on(key, listener);
    return () => {
      this.notifications.off(key, listener);
    };
  }

  /** Subscribes to every notification. Phase 4 fans these out over WebSocket. */
  onAny(listener: (notification: WireServerNotification) => void): () => void {
    this.notifications.on(ANY_EVENT, listener);
    return () => {
      this.notifications.off(ANY_EVENT, listener);
    };
  }

  private async connect(): Promise<void> {
    await this.transport.start();

    // Cannot go through request(): initialize is what makes us ready, so it
    // must not wait on readiness.
    const response = await this.dispatch<InitializeResponse>(
      'initialize',
      { clientInfo: CLIENT_INFO, capabilities: null },
      INITIALIZE_TIMEOUT_MS,
    );

    // The handshake completes only once the server has been told so.
    this.transport.send({ method: 'initialized' });

    this.initializeResponse = response;
    this.connected = true;
    this.lastError = null;

    this.logger.log(`Connected over ${this.transport.name} — ${response.userAgent}`);
    // Logged every boot on purpose: CODEX_HOME is inherited from the ambient
    // environment, and it decides where credentials and thread history land.
    this.logger.log(`Codex home: ${response.codexHome}`);
  }

  private dispatch<TResult>(method: string, params: unknown, timeoutMs: number): Promise<TResult> {
    const id = this.nextRequestId++;

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        method,
      });

      try {
        this.transport.send(params === undefined ? { id, method } : { id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  private handleInbound(message: WireInbound): void {
    const classified = classifyInbound(message);

    switch (classified.kind) {
      case 'response':
        this.handleResponse(classified.message);
        return;
      case 'request':
        void this.handleServerRequest(classified.message);
        return;
      case 'notification':
        this.handleNotification(classified.message);
        return;
      default:
        this.logger.warn('Ignoring an unrecognised message from app-server');
    }
  }

  private handleResponse(response: WireResponse): void {
    const id = typeof response.id === 'number' ? response.id : Number(response.id);
    const pending = this.pending.get(id);

    if (!pending) {
      this.logger.warn(`Response for unknown request id ${String(response.id)}`);
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (response.error) {
      const { code, message, data } = response.error;
      pending.reject(new CodexRpcError(pending.method, code, message, data));
      return;
    }

    pending.resolve(response.result);
  }

  /**
   * Answers a server-initiated request. The app-server is blocked until we
   * reply, so this path always sends something back.
   */
  private async handleServerRequest(request: WireServerRequest): Promise<void> {
    this.logger.debug(`Server request: ${request.method} (id=${String(request.id)})`);

    const outcome = await this.serverRequests.resolve(request);
    const reply: WireClientResponse = outcome.error
      ? { id: request.id, error: outcome.error }
      : { id: request.id, result: outcome.result };

    try {
      this.transport.send(reply);
    } catch (error) {
      this.logger.error(`Could not answer ${request.method}: ${(error as Error).message}`);
    }
  }

  private handleNotification(notification: WireServerNotification): void {
    this.notifications.emit(EVENT_PREFIX + notification.method, notification.params);
    this.notifications.emit(ANY_EVENT, notification);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.connected = false;
    this.initializeResponse = null;

    if (!this.shuttingDown) {
      this.lastError = `app-server exited (code=${code}, signal=${signal ?? 'none'})`;
      this.failAllPending(new Error(this.lastError));
      this.logger.error(`${this.lastError} — the next request will reconnect`);
    }
  }

  private failAllPending(reason: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(reason);
    }
  }
}
