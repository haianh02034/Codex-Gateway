export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

export interface LoginResult {
  accessToken: string;
  expiresIn: string;
  user: AuthUser;
}

export interface Project {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export type ConversationStatus = 'idle' | 'running' | 'failed';

export interface Conversation {
  id: string;
  projectId: string | null;
  title: string;
  status: ConversationStatus;
  workspacePath: string;
  model: string | null;
  activeTurnId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MessageStatus = 'pending' | 'completed' | 'failed' | 'interrupted';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  turnId: string | null;
  createdAt: string;
}

export interface SendMessageResult {
  messageId: string;
  turnId: string;
  disposition: 'started' | 'steered';
}

export type ApprovalStatus =
  | 'pending'
  | 'allowed'
  | 'allowedForSession'
  | 'denied'
  | 'timedOut'
  | 'abandoned';

export interface Approval {
  id: string;
  conversationId: string;
  method: string;
  status: ApprovalStatus;
  detail: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
}

export type ApprovalDecision = 'allow' | 'allowForSession' | 'deny';

export interface Quota {
  primary: { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null } | null;
  secondary: { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null } | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  planType: string | null;
  limitReached: string | null;
  updatedAt: string | null;
}

export type CodexLoginMethod = 'browser' | 'deviceCode';

/** A login waiting for a person to finish it in a browser. */
export interface PendingLogin {
  loginId: string;
  method: CodexLoginMethod;
  /** Open this to continue. */
  url: string;
  /** Device-code flow only: the short code to type after signing in. */
  userCode: string | null;
  startedAt: string;
  expiresAt: string;
}

/** Admin view: adds the signed-in account and any login still in flight. */
export interface CodexAdminAuthStatus extends CodexAuthStatus {
  account: { email: string | null; planType: string | null } | null;
  pendingLogin: PendingLogin | null;
}

export interface StartLoginResult {
  state: 'pending';
  login: PendingLogin;
  replacedPreviousLogin: boolean;
}

export interface CodexAuthStatus {
  state: 'authenticated' | 'pending' | 'unauthenticated';
  authenticated: boolean;
  authMethod: string | null;
  requiresOpenaiAuth: boolean | null;
}

/**
 * One event from the gateway's `codex.event` channel.
 *
 * `method` is the Codex protocol name, passed through unchanged, except for
 * the gateway's own events which are prefixed `gateway/`. Every protocol
 * method contains a slash, so the prefix is unambiguous.
 */
export interface GatewayEvent {
  conversationId: string;
  method: string;
  params: unknown;
}

/** A command Codex ran or a file it changed, as the activity feed shows it. */
export interface ActivityItem {
  id: string;
  turnId: string;
  kind: string;
  label: string;
  detail: string;
  status: 'running' | 'done' | 'failed';
}
