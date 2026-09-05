import { WireInbound, WireOutbound } from './wire.types';

export interface TransportExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * How the gateway reaches the Codex app-server.
 *
 * Phase 1 ships {@link StdioTransport}: a child process owned by this service,
 * which needs no port and no authentication because nothing is listening.
 * Phase 7 can add a WebSocket transport against `--listen ws://` without the
 * client above it changing — that is the entire reason this seam exists.
 *
 * Implementations deal in whole messages. Framing is their problem, not the
 * client's.
 */
export interface CodexTransport {
  /** Short label used in logs and health output. */
  readonly name: string;

  /** Connects. Resolves once messages can be sent. */
  start(): Promise<void>;

  /** Queues one message. Throws if the transport is not running. */
  send(message: WireOutbound): void;

  /** Shuts down cleanly. Safe to call when already stopped. */
  close(): Promise<void>;

  /** Called for every decoded inbound message. */
  onMessage(listener: (message: WireInbound) => void): void;

  /** Called once when the connection ends, expectedly or not. */
  onExit(listener: (exit: TransportExit) => void): void;
}

export const CODEX_TRANSPORT = Symbol('CODEX_TRANSPORT');
