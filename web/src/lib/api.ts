import type {
  Approval,
  ApprovalDecision,
  ChatMode,
  ChatModeOption,
  CodexAdminAuthStatus,
  CodexAuthStatus,
  CodexLoginMethod,
  Conversation,
  LoginResult,
  Message,
  Project,
  Quota,
  SendMessageResult,
  StartLoginResult,
} from './types';

const BASE = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'codex-gateway.token';

/** Carries the status so callers can tell "signed out" from "went wrong". */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const session = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string): void {
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    window.localStorage.removeItem(TOKEN_KEY);
  },
};

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Skips the Authorization header, for the login call itself. */
  anonymous?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  if (!options.anonymous) {
    const token = session.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, messageOf(parsed) ?? `Request failed (${response.status})`);
  }

  return parsed as T;
}

/** The gateway returns a string, or an array of them from validation. */
function messageOf(payload: unknown): string | null {
  const message = (payload as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return null;
}

export const api = {
  baseUrl: BASE,

  login: (email: string, password: string) =>
    request<LoginResult>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      anonymous: true,
    }),

  me: () => request<import('./types').AuthUser>('/api/auth/me'),

  codexAuthStatus: () => request<CodexAuthStatus>('/api/codex/auth/status'),
  quota: () => request<Quota>('/api/codex/rate-limits'),
  // Rendered from the gateway's definitions so the picker cannot drift from
  // the presets that actually reach turn/start.
  chatModes: () => request<ChatModeOption[]>('/api/codex/modes'),

  // Codex's own account, which is global to the host. Admin only, and the
  // gateway enforces that — these calls simply fail for anyone else.
  codexAdminStatus: () => request<CodexAdminAuthStatus>('/api/admin/codex/auth/status'),
  startCodexLogin: (method: CodexLoginMethod) =>
    request<StartLoginResult>('/api/admin/codex/auth/login', {
      method: 'POST',
      body: { method },
    }),
  cancelCodexLogin: () =>
    request<{ cancelled: boolean; detail: string }>('/api/admin/codex/auth/login/cancel', {
      method: 'POST',
    }),
  codexLogout: () =>
    request<{ state: string }>('/api/admin/codex/auth/logout', { method: 'POST' }),

  projects: () => request<Project[]>('/api/projects'),
  createProject: (name: string, workspacePath: string) =>
    request<Project>('/api/projects', { method: 'POST', body: { name, workspacePath } }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),

  conversations: () => request<Conversation[]>('/api/conversations'),
  conversation: (id: string) => request<Conversation>(`/api/conversations/${id}`),
  createConversation: (title: string, projectId: string | null) =>
    request<Conversation>('/api/conversations', {
      method: 'POST',
      body: projectId ? { title, projectId } : { title },
    }),
  renameConversation: (id: string, title: string) =>
    request<Conversation>(`/api/conversations/${id}`, { method: 'PATCH', body: { title } }),
  deleteConversation: (id: string) =>
    request<void>(`/api/conversations/${id}`, { method: 'DELETE' }),

  messages: (id: string) => request<Message[]>(`/api/conversations/${id}/messages`),
  send: (id: string, text: string, mode?: ChatMode) =>
    request<SendMessageResult>(`/api/conversations/${id}/messages`, {
      method: 'POST',
      body: mode ? { text, mode } : { text },
    }),
  interrupt: (id: string) =>
    request<{ interrupted: true }>(`/api/conversations/${id}/interrupt`, { method: 'POST' }),

  approvals: (conversationId: string) =>
    request<Approval[]>(`/api/conversations/${conversationId}/approvals`),
  resolveApproval: (id: string, decision: ApprovalDecision) =>
    request<Approval>(`/api/approvals/${id}/resolve`, { method: 'POST', body: { decision } }),
};
