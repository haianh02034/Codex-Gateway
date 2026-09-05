import type { AuthMode } from '../protocol/generated/AuthMode';
import type { PlanType } from '../protocol/generated/PlanType';

/**
 * How the administrator wants to sign Codex in.
 *
 * `browser` is the ChatGPT OAuth flow. Its callback lands on a loopback port of
 * the machine running Codex, so it only works when the administrator's browser
 * and the gateway are on the same host — true in development, not true for a
 * remote deployment.
 *
 * `deviceCode` exists for exactly that case: the code is entered on any device,
 * and nothing has to reach the server's loopback interface.
 */
export enum CodexLoginMethod {
  Browser = 'browser',
  DeviceCode = 'deviceCode',
}

export type CodexAuthState = 'authenticated' | 'pending' | 'unauthenticated';

/**
 * What any signed-in user of the gateway may see.
 *
 * Deliberately narrow. `getAuthStatus` also returns the live OpenAI access
 * token, which must never travel any further than this process.
 */
export interface CodexAuthStatus {
  state: CodexAuthState;
  authenticated: boolean;
  authMethod: AuthMode | null;
  requiresOpenaiAuth: boolean | null;
}

/** The pending half of a login, visible to administrators only. */
export interface PendingLoginView {
  loginId: string;
  method: CodexLoginMethod;
  /** Open in a browser to continue. */
  url: string;
  /** Device-code flow only: the code to enter after signing in. */
  userCode: string | null;
  startedAt: string;
  /** Imposed by the gateway, not reported by Codex. */
  expiresAt: string;
}

/** Status plus the parts only an administrator should see. */
export interface CodexAdminAuthStatus extends CodexAuthStatus {
  account: { email: string | null; planType: PlanType | null } | null;
  pendingLogin: PendingLoginView | null;
}

export interface StartLoginResult {
  state: 'pending';
  login: PendingLoginView;
  /** True when an earlier unfinished login was cancelled to make room. */
  replacedPreviousLogin: boolean;
}

export interface CancelLoginResult {
  cancelled: boolean;
  detail: string;
}

export interface LogoutResult {
  state: 'unauthenticated';
  /** True when a login was in flight and got cancelled as part of this. */
  cancelledPendingLogin: boolean;
}
