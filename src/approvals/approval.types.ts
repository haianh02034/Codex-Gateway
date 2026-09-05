/** What a person can answer. Mapped per method onto Codex's own vocabularies. */
export enum ApprovalDecision {
  Allow = 'allow',
  AllowForSession = 'allowForSession',
  Deny = 'deny',
}

export enum ApprovalStatus {
  Pending = 'pending',
  Allowed = 'allowed',
  AllowedForSession = 'allowedForSession',
  Denied = 'denied',
  /** Nobody answered in time; Codex was told to decline. */
  TimedOut = 'timedOut',
  /** The gateway restarted, or the turn ended, before anyone answered. */
  Abandoned = 'abandoned',
}

export interface ApprovalView {
  id: string;
  conversationId: string;
  method: string;
  status: ApprovalStatus;
  /** Method-specific detail: the command, its cwd, the files, the reason. */
  detail: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
}
