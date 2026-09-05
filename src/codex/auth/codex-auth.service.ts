import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';

import { CodexClientService } from '../app-server/codex-client.service';
import type { GetAuthStatusResponse } from '../protocol/generated/GetAuthStatusResponse';
import type { CancelLoginAccountResponse } from '../protocol/generated/v2/CancelLoginAccountResponse';
import type { GetAccountResponse } from '../protocol/generated/v2/GetAccountResponse';
import type { LoginAccountResponse } from '../protocol/generated/v2/LoginAccountResponse';
import {
  CancelLoginResult,
  CodexAdminAuthStatus,
  CodexAuthStatus,
  CodexLoginMethod,
  LogoutResult,
  PendingLoginView,
  StartLoginResult,
} from './codex-auth.types';

/**
 * How long the gateway keeps offering a pending login before treating it as
 * abandoned. Codex reports no expiry of its own, so this ceiling is ours.
 */
const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;

interface PendingLogin {
  loginId: string;
  method: CodexLoginMethod;
  url: string;
  userCode: string | null;
  startedAt: Date;
  expiresAt: Date;
}

/**
 * Drives Codex's own authentication.
 *
 * Two things shape everything here. First, Codex holds a single identity for
 * the whole host, so signing in or out is a host-wide act and belongs to an
 * administrator — the controllers, not this service, enforce that. Second,
 * `getAuthStatus` hands back a live OpenAI access token, so every response is
 * assembled field by field and never spread from the protocol payload.
 */
@Injectable()
export class CodexAuthService implements OnModuleInit {
  private readonly logger = new Logger(CodexAuthService.name);
  private pending: PendingLogin | null = null;

  constructor(private readonly client: CodexClientService) {}

  onModuleInit(): void {
    // Completion is pushed, so nothing here polls.
    this.client.on('account/login/completed', (params) => {
      this.handleLoginCompleted(params);
    });
  }

  /** Safe for any signed-in user: no token, no login URL. */
  async getStatus(): Promise<CodexAuthStatus> {
    const status = await this.fetchAuthStatus();
    const authenticated = status.authMethod !== null;

    return {
      state: authenticated ? 'authenticated' : this.hasLivePending() ? 'pending' : 'unauthenticated',
      authenticated,
      authMethod: status.authMethod,
      requiresOpenaiAuth: status.requiresOpenaiAuth,
    };
  }

  /**
   * Administrator view. Adds which account is signed in and any login still in
   * flight — including its URL, which is why this is not on the shared status
   * endpoint: opening that URL binds a ChatGPT account to this gateway.
   */
  async getAdminStatus(): Promise<CodexAdminAuthStatus> {
    const base = await this.getStatus();
    let account: CodexAdminAuthStatus['account'] = null;

    if (base.authenticated) {
      try {
        const response = await this.call<GetAccountResponse>('account/read', {
          refreshToken: false,
        });
        const current = response.account;
        account =
          current && current.type === 'chatgpt'
            ? { email: current.email, planType: current.planType }
            : null;
      } catch (error) {
        // Account detail is a nicety; never fail the whole status for it.
        this.logger.warn(`Could not read the Codex account: ${(error as Error).message}`);
      }
    }

    return { ...base, account, pendingLogin: this.viewOf(this.pending) };
  }

  /**
   * Starts a login and returns the URL to open.
   *
   * Any unfinished login is cancelled first, so this always yields a URL that
   * actually works rather than resurrecting a stale one.
   */
  async startLogin(method: CodexLoginMethod): Promise<StartLoginResult> {
    const replaced = await this.clearPendingLogin('superseded by a new login');

    const params =
      method === CodexLoginMethod.DeviceCode
        ? { type: 'chatgptDeviceCode' as const }
        : { type: 'chatgpt' as const };

    const response = await this.call<LoginAccountResponse>('account/login/start', params);
    const pending = this.toPendingLogin(response, method);

    this.pending = pending;
    this.logger.log(`Codex login started (${method}, loginId=${pending.loginId})`);

    return {
      state: 'pending',
      login: this.viewOf(pending)!,
      replacedPreviousLogin: replaced,
    };
  }

  async cancelLogin(): Promise<CancelLoginResult> {
    if (!this.pending) {
      return { cancelled: false, detail: 'No login is in progress' };
    }

    const loginId = this.pending.loginId;
    const cancelled = await this.clearPendingLogin('cancelled by an administrator');

    return {
      cancelled,
      detail: cancelled
        ? `Login ${loginId} was cancelled`
        : `Codex no longer knew about login ${loginId}`,
    };
  }

  /** Signs Codex out for every user of this gateway. */
  async logout(): Promise<LogoutResult> {
    const cancelledPendingLogin = await this.clearPendingLogin('logging out');

    await this.call('account/logout');
    this.logger.warn('Codex signed out — this affects every user of the gateway');

    return { state: 'unauthenticated', cancelledPendingLogin };
  }

  private async fetchAuthStatus(): Promise<GetAuthStatusResponse> {
    // includeToken:false is the whole point. The response type carries a live
    // access token when asked, and nothing in the gateway needs it.
    return this.call<GetAuthStatusResponse>('getAuthStatus', {
      includeToken: false,
      refreshToken: false,
    });
  }

  /** Cancels any live pending login. Returns whether Codex knew about it. */
  private async clearPendingLogin(reason: string): Promise<boolean> {
    const pending = this.pending;
    if (!pending) return false;

    this.pending = null;

    try {
      const response = await this.call<CancelLoginAccountResponse>('account/login/cancel', {
        loginId: pending.loginId,
      });
      this.logger.log(`Login ${pending.loginId} ${reason} (${response.status})`);
      return response.status === 'canceled';
    } catch (error) {
      this.logger.warn(`Could not cancel login ${pending.loginId}: ${(error as Error).message}`);
      return false;
    }
  }

  private handleLoginCompleted(params: unknown): void {
    const payload = params as { loginId?: string | null; success?: boolean; error?: string | null };
    const pending = this.pending;

    if (payload.success) {
      this.logger.log(`Codex login completed (loginId=${payload.loginId ?? 'unknown'})`);
    } else {
      this.logger.error(`Codex login failed: ${payload.error ?? 'no reason given'}`);
    }

    // A completion for some other login — another client on the same host —
    // must not clear ours.
    if (pending && payload.loginId && payload.loginId !== pending.loginId) {
      this.logger.warn(`Ignoring completion for an unrelated login ${payload.loginId}`);
      return;
    }

    this.pending = null;
  }

  private toPendingLogin(response: LoginAccountResponse, method: CodexLoginMethod): PendingLogin {
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + PENDING_LOGIN_TTL_MS);

    if (response.type === 'chatgpt') {
      return {
        loginId: response.loginId,
        method,
        url: response.authUrl,
        userCode: null,
        startedAt,
        expiresAt,
      };
    }

    if (response.type === 'chatgptDeviceCode') {
      return {
        loginId: response.loginId,
        method,
        url: response.verificationUrl,
        userCode: response.userCode,
        startedAt,
        expiresAt,
      };
    }

    // Codex answered with a flow we did not ask for — for example an API key
    // was already configured, so no browser step exists.
    throw new ServiceUnavailableException(
      `Codex started a "${response.type}" login, which needs no browser step`,
    );
  }

  private hasLivePending(): boolean {
    if (!this.pending) return false;
    if (this.pending.expiresAt.getTime() > Date.now()) return true;

    this.logger.log(`Login ${this.pending.loginId} expired without completing`);
    this.pending = null;
    return false;
  }

  private viewOf(pending: PendingLogin | null): PendingLoginView | null {
    if (!pending || !this.hasLivePending()) return null;

    return {
      loginId: pending.loginId,
      method: pending.method,
      url: pending.url,
      userCode: pending.userCode,
      startedAt: pending.startedAt.toISOString(),
      expiresAt: pending.expiresAt.toISOString(),
    };
  }

  private call<TResult>(method: string, params?: unknown): Promise<TResult> {
    return this.client.requestOrUnavailable<TResult>(method, params);
  }
}
