import { CodexRpcError, CodexClientService } from './codex-client.service';
import { CodexTransport, TransportExit } from './codex-transport';
import { ServerRequestRegistry } from './server-request.registry';
import { WireInbound, WireOutbound, WireRequest } from './wire.types';

/**
 * Stands in for a real app-server. Lets a test push any inbound message and
 * inspect everything the client sent, which is the only way to exercise the
 * server-request path before Codex is logged in.
 */
class FakeTransport implements CodexTransport {
  readonly name = 'fake';
  readonly sent: WireOutbound[] = [];
  started = false;
  closed = false;
  exited = false;

  private messageListeners: ((message: WireInbound) => void)[] = [];
  private exitListeners: ((exit: TransportExit) => void)[] = [];

  async start(): Promise<void> {
    this.started = true;
  }

  send(message: WireOutbound): void {
    // Mirrors StdioTransport: writing to a dead process is an error, not a
    // silent no-op. Without this the fake hides real failure behaviour.
    if (this.exited || this.closed) {
      throw new Error('The Codex app-server is not running');
    }
    this.sent.push(message);

    // Answer the handshake so ensureReady() can complete.
    const request = message as WireRequest;
    if (request.method === 'initialize' && request.id !== undefined) {
      queueMicrotask(() =>
        this.emit({
          id: request.id,
          result: {
            userAgent: 'fake/0.153.4',
            codexHome: '/tmp/codex-home',
            platformFamily: 'unix',
            platformOs: 'linux',
          },
        }),
      );
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private markExited(): void {
    this.exited = true;
  }

  onMessage(listener: (message: WireInbound) => void): void {
    this.messageListeners.push(listener);
  }

  onExit(listener: (exit: TransportExit) => void): void {
    this.exitListeners.push(listener);
  }

  emit(message: WireInbound): void {
    for (const listener of this.messageListeners) listener(message);
  }

  emitExit(exit: TransportExit): void {
    this.markExited();
    for (const listener of this.exitListeners) listener(exit);
  }

  /** The last request sent, ignoring notifications and responses. */
  lastRequest(): WireRequest {
    const requests = this.sent.filter(
      (m): m is WireRequest => 'method' in m && 'id' in m,
    );
    return requests[requests.length - 1];
  }
}

describe('CodexClientService', () => {
  let transport: FakeTransport;
  let registry: ServerRequestRegistry;
  let client: CodexClientService;

  beforeEach(() => {
    transport = new FakeTransport();
    registry = new ServerRequestRegistry();
    client = new CodexClientService(transport, registry);
    jest.spyOn(registry['logger'], 'warn').mockImplementation(() => undefined);
  });

  describe('handshake', () => {
    it('sends initialize and then the initialized notification', async () => {
      await client.ensureReady();

      const methods = transport.sent.map((m) => (m as WireRequest).method);
      expect(methods).toEqual(['initialize', 'initialized']);
      expect(client.isConnected()).toBe(true);
    });

    it('reports what the server said about itself, not what we assumed', async () => {
      await client.ensureReady();

      expect(client.getStatus()).toMatchObject({
        connected: true,
        transport: 'fake',
        codexHome: '/tmp/codex-home',
        platformOs: 'linux',
      });
    });

    it('runs one handshake for concurrent callers', async () => {
      await Promise.all([client.ensureReady(), client.ensureReady(), client.ensureReady()]);

      const initializes = transport.sent.filter((m) => (m as WireRequest).method === 'initialize');
      expect(initializes).toHaveLength(1);
    });
  });

  describe('requests', () => {
    it('resolves with the result payload', async () => {
      await client.ensureReady();

      const pending = client.request<{ authMethod: string | null }>('getAuthStatus', {
        includeToken: false,
      });
      await flush();
      transport.emit({ id: transport.lastRequest().id, result: { authMethod: null } });

      await expect(pending).resolves.toEqual({ authMethod: null });
    });

    it('rejects with CodexRpcError when the server returns an error', async () => {
      await client.ensureReady();

      const pending = client.request('no/such/method');
      await flush();
      transport.emit({
        id: transport.lastRequest().id,
        error: { code: -32600, message: 'Invalid request' },
      });

      await expect(pending).rejects.toBeInstanceOf(CodexRpcError);
      await expect(pending).rejects.toThrow('no/such/method failed (-32600): Invalid request');
    });

    it('rejects everything in flight when app-server exits', async () => {
      await client.ensureReady();

      const pending = client.request('thread/start');
      await flush();
      transport.emitExit({ code: 1, signal: null });

      await expect(pending).rejects.toThrow('app-server exited');
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('server-initiated requests', () => {
    it('declines a command approval instead of leaving the server blocked', async () => {
      await client.ensureReady();

      transport.emit({
        id: 77,
        method: 'item/commandExecution/requestApproval',
        params: { command: ['rm', '-rf', '/'] },
      });
      await flush();

      expect(transport.sent).toContainEqual({ id: 77, result: { decision: 'decline' } });
    });

    it('uses the legacy decision shape for the pre-v2 approval method', async () => {
      await client.ensureReady();

      transport.emit({ id: 78, method: 'execCommandApproval', params: {} });
      await flush();

      const reply = transport.sent.find((m) => (m as { id?: unknown }).id === 78);
      expect(reply).toMatchObject({
        id: 78,
        result: { decision: { denied: { rejection: expect.any(String) as unknown as string } } },
      });
    });

    it('answers an unknown server request with an error rather than silence', async () => {
      await client.ensureReady();

      transport.emit({ id: 79, method: 'attestation/generate', params: {} });
      await flush();

      expect(transport.sent).toContainEqual({
        id: 79,
        error: { code: -32601, message: 'The gateway cannot answer attestation/generate yet' },
      });
    });

    it('routes to a registered responder once Phase 5 supplies one', async () => {
      registry.register('item/commandExecution/requestApproval', async () => ({
        decision: 'accept',
      }));
      await client.ensureReady();

      transport.emit({ id: 80, method: 'item/commandExecution/requestApproval', params: {} });
      await flush();

      expect(transport.sent).toContainEqual({ id: 80, result: { decision: 'accept' } });
    });

    it('falls back to a decline when a responder throws', async () => {
      registry.register('item/fileChange/requestApproval', () => {
        throw new Error('responder exploded');
      });
      jest.spyOn(registry['logger'], 'error').mockImplementation(() => undefined);
      await client.ensureReady();

      transport.emit({ id: 81, method: 'item/fileChange/requestApproval', params: {} });
      await flush();

      expect(transport.sent).toContainEqual({ id: 81, result: { decision: 'decline' } });
    });
  });

  describe('notifications', () => {
    it('delivers to a method subscriber and to onAny', async () => {
      await client.ensureReady();

      const specific = jest.fn();
      const any = jest.fn();
      client.on('account/login/completed', specific);
      client.onAny(any);

      transport.emit({
        method: 'account/login/completed',
        params: { loginId: 'abc', success: true, error: null },
      });

      expect(specific).toHaveBeenCalledWith({ loginId: 'abc', success: true, error: null });
      expect(any).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'account/login/completed' }),
      );
    });

    it('stops delivering after unsubscribe', async () => {
      await client.ensureReady();

      const listener = jest.fn();
      const unsubscribe = client.on('turn/completed', listener);
      unsubscribe();

      transport.emit({ method: 'turn/completed', params: {} });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('closes the transport and rejects anything in flight', async () => {
      await client.ensureReady();
      const pending = client.request('thread/start');
      await flush();

      await client.onModuleDestroy();

      expect(transport.closed).toBe(true);
      await expect(pending).rejects.toThrow('shutting down');
    });
  });
});

/** Lets the client's async server-request handling settle. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
