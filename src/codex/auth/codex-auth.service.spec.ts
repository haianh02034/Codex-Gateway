import { ServiceUnavailableException } from '@nestjs/common';

import { CodexClientService } from '../app-server/codex-client.service';
import { CodexAuthService } from './codex-auth.service';
import { CodexLoginMethod } from './codex-auth.types';

const SECRET_TOKEN = 'sk-live-DO-NOT-LEAK-THIS';

interface RecordedCall {
  method: string;
  params: unknown;
}

/** Minimal stand-in for the app-server client. */
class FakeClient {
  readonly calls: RecordedCall[] = [];
  readonly responses = new Map<string, unknown>();
  connected = true;
  failWith: Error | null = null;

  private listeners = new Map<string, ((params: unknown) => void)[]>();

  async request<T>(method: string, params?: unknown): Promise<T> {
    this.calls.push({ method, params });
    if (this.failWith) throw this.failWith;
    return this.responses.get(method) as T;
  }

  on(method: string, listener: (params: unknown) => void): () => void {
    const existing = this.listeners.get(method) ?? [];
    existing.push(listener);
    this.listeners.set(method, existing);
    return () => undefined;
  }

  isConnected(): boolean {
    return this.connected;
  }

  emit(method: string, params: unknown): void {
    for (const listener of this.listeners.get(method) ?? []) listener(params);
  }

  paramsFor(method: string): unknown {
    return this.calls.find((call) => call.method === method)?.params;
  }
}

describe('CodexAuthService', () => {
  let client: FakeClient;
  let service: CodexAuthService;

  beforeEach(() => {
    client = new FakeClient();
    client.responses.set('getAuthStatus', {
      authMethod: null,
      authToken: null,
      requiresOpenaiAuth: true,
    });
    service = new CodexAuthService(client as unknown as CodexClientService);
    service.onModuleInit();
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  const signedIn = () =>
    client.responses.set('getAuthStatus', {
      authMethod: 'chatgpt',
      authToken: SECRET_TOKEN,
      requiresOpenaiAuth: false,
    });

  const browserLogin = (loginId = 'login-1') =>
    client.responses.set('account/login/start', {
      type: 'chatgpt',
      loginId,
      authUrl: `https://auth.openai.com/${loginId}`,
    });

  describe('token containment', () => {
    it('never puts the access token in the user-facing status', async () => {
      signedIn();

      const status = await service.getStatus();

      expect(JSON.stringify(status)).not.toContain(SECRET_TOKEN);
      expect(status).toEqual({
        state: 'authenticated',
        authenticated: true,
        authMethod: 'chatgpt',
        requiresOpenaiAuth: false,
      });
    });

    it('never puts the access token in the admin status either', async () => {
      signedIn();
      client.responses.set('account/read', {
        account: { type: 'chatgpt', email: 'owner@example.com', planType: 'plus' },
        requiresOpenaiAuth: false,
      });

      const status = await service.getAdminStatus();

      expect(JSON.stringify(status)).not.toContain(SECRET_TOKEN);
      expect(status.account).toEqual({ email: 'owner@example.com', planType: 'plus' });
    });

    it('asks Codex not to include the token in the first place', async () => {
      await service.getStatus();

      expect(client.paramsFor('getAuthStatus')).toEqual({
        includeToken: false,
        refreshToken: false,
      });
    });
  });

  describe('status', () => {
    it('reads unauthenticated when Codex has no auth method', async () => {
      await expect(service.getStatus()).resolves.toMatchObject({
        state: 'unauthenticated',
        authenticated: false,
      });
    });

    it('reads pending once a login has been started', async () => {
      browserLogin();
      await service.startLogin(CodexLoginMethod.Browser);

      await expect(service.getStatus()).resolves.toMatchObject({
        state: 'pending',
        authenticated: false,
      });
    });

    it('survives a failure to read the account detail', async () => {
      signedIn();
      client.responses.set('account/read', undefined);

      const status = await service.getAdminStatus();

      expect(status.authenticated).toBe(true);
      expect(status.account).toBeNull();
    });
  });

  describe('starting a login', () => {
    it('returns the URL to open for the browser flow', async () => {
      browserLogin('abc');

      const result = await service.startLogin(CodexLoginMethod.Browser);

      expect(result.login).toMatchObject({
        loginId: 'abc',
        method: CodexLoginMethod.Browser,
        url: 'https://auth.openai.com/abc',
        userCode: null,
      });
      expect(result.replacedPreviousLogin).toBe(false);
    });

    it('returns the verification URL and code for the device flow', async () => {
      client.responses.set('account/login/start', {
        type: 'chatgptDeviceCode',
        loginId: 'dev-1',
        verificationUrl: 'https://auth.openai.com/device',
        userCode: 'WXYZ-1234',
      });

      const result = await service.startLogin(CodexLoginMethod.DeviceCode);

      expect(result.login).toMatchObject({
        url: 'https://auth.openai.com/device',
        userCode: 'WXYZ-1234',
      });
    });

    it('cancels an unfinished login before starting another', async () => {
      browserLogin('first');
      client.responses.set('account/login/cancel', { status: 'canceled' });
      await service.startLogin(CodexLoginMethod.Browser);

      browserLogin('second');
      const result = await service.startLogin(CodexLoginMethod.Browser);

      expect(client.paramsFor('account/login/cancel')).toEqual({ loginId: 'first' });
      expect(result.replacedPreviousLogin).toBe(true);
      expect(result.login.loginId).toBe('second');
    });

    it('rejects a flow that needs no browser step', async () => {
      client.responses.set('account/login/start', { type: 'apiKey' });

      await expect(service.startLogin(CodexLoginMethod.Browser)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('login completion', () => {
    it('clears the pending login when Codex reports success', async () => {
      browserLogin('abc');
      await service.startLogin(CodexLoginMethod.Browser);

      client.emit('account/login/completed', { loginId: 'abc', success: true, error: null });

      const status = await service.getAdminStatus();
      expect(status.pendingLogin).toBeNull();
    });

    it('keeps our login when another client on the host finishes theirs', async () => {
      browserLogin('ours');
      await service.startLogin(CodexLoginMethod.Browser);

      client.emit('account/login/completed', {
        loginId: 'someone-else',
        success: true,
        error: null,
      });

      const status = await service.getAdminStatus();
      expect(status.pendingLogin?.loginId).toBe('ours');
    });

    it('clears the pending login when Codex reports failure', async () => {
      browserLogin('abc');
      await service.startLogin(CodexLoginMethod.Browser);

      client.emit('account/login/completed', {
        loginId: 'abc',
        success: false,
        error: 'user declined',
      });

      const status = await service.getAdminStatus();
      expect(status.pendingLogin).toBeNull();
    });
  });

  describe('logout', () => {
    it('signs out and cancels anything in flight', async () => {
      browserLogin('abc');
      client.responses.set('account/login/cancel', { status: 'canceled' });
      await service.startLogin(CodexLoginMethod.Browser);

      const result = await service.logout();

      expect(result).toEqual({ state: 'unauthenticated', cancelledPendingLogin: true });
      expect(client.calls.map((c) => c.method)).toContain('account/logout');
    });

    it('reports nothing to cancel when no login was running', async () => {
      const result = await service.logout();
      expect(result.cancelledPendingLogin).toBe(false);
    });
  });

  describe('when app-server is unreachable', () => {
    it('surfaces 503 rather than a generic failure', async () => {
      client.connected = false;
      client.failWith = new Error('The Codex app-server is not running');

      await expect(service.getStatus()).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('passes through a real protocol error while still connected', async () => {
      client.failWith = new Error('boom');

      await expect(service.getStatus()).rejects.toThrow('boom');
    });
  });
});
