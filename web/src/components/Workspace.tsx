'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, session } from '@/lib/api';
import type {
  ActivityItem,
  Approval,
  ApprovalDecision,
  AuthUser,
  ChatMode,
  ChatModeOption,
  Conversation,
  GatewayEvent,
  Message,
  Project,
  Quota,
} from '@/lib/types';
import { useGatewaySocket } from '@/lib/useGatewaySocket';

import { Chat } from './Chat';
import { CodexAccountPanel } from './CodexAccountPanel';
import { Sidebar } from './Sidebar';

export function Workspace({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [running, setRunning] = useState(false);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [codexSignedIn, setCodexSignedIn] = useState(true);
  const [codexAccount, setCodexAccount] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [modes, setModes] = useState<ChatModeOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Read inside the socket callback, which is created once and must not close
  // over a stale conversation id.
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  // Read after mount: localStorage does not exist while rendering on the server.
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => setToken(session.get()), []);

  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;

  const refreshConversations = useCallback(async () => {
    setConversations(await api.conversations());
  }, []);

  const loadConversation = useCallback(async (id: string, keepActivity = false) => {
    const [history, pending] = await Promise.all([api.messages(id), api.approvals(id)]);
    setMessages(history);
    setApprovals(pending.filter((approval) => approval.status === 'pending'));
    setStreaming('');
    // Reloading after a turn must not wipe the record of what the agent just
    // did; only switching conversations starts from a blank feed.
    if (!keepActivity) setActivity([]);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [projectList, conversationList, status, currentQuota, modeList] = await Promise.all([
          api.projects(),
          api.conversations(),
          api.codexAuthStatus(),
          api.quota(),
          api.chatModes().catch(() => []),
        ]);
        setProjects(projectList);
        setConversations(conversationList);
        setModes(modeList);
        setCodexSignedIn(status.authenticated);
        setQuota(currentQuota);

        // Only admins may read this, so a failure here is expected for
        // everyone else and must not break the page.
        if (user.role === 'admin') {
          void api
            .codexAdminStatus()
            .then((admin) => setCodexAccount(admin.account?.email ?? null))
            .catch(() => undefined);
        }
        if (conversationList.length > 0) setActiveId(conversationList[0].id);
      } catch (caught) {
        setError((caught as Error).message);
      }
    })();
  }, [user.role]);

  /** After the Codex account changes, everything downstream of it is stale. */
  const reloadCodexState = useCallback(async () => {
    const [status, admin, currentQuota] = await Promise.all([
      api.codexAuthStatus(),
      api.codexAdminStatus().catch(() => null),
      api.quota().catch(() => null),
    ]);
    setCodexSignedIn(status.authenticated);
    setCodexAccount(admin?.account?.email ?? null);
    if (currentQuota) setQuota(currentQuota);
  }, []);

  useEffect(() => {
    if (!activeId) return;
    void loadConversation(activeId).catch((caught: Error) => setError(caught.message));
    setRunning(false);
  }, [activeId, loadConversation]);

  const onEvent = useCallback(
    (event: GatewayEvent) => {
      // A late event from a conversation we just left must not bleed into the
      // one now on screen.
      if (event.conversationId !== activeRef.current) return;

      const params = event.params as Record<string, unknown>;

      switch (event.method) {
        case 'turn/started':
          setRunning(true);
          setStreaming('');
          setActivity([]);
          return;

        case 'item/agentMessage/delta':
          setStreaming((current) => current + String(params.delta ?? ''));
          return;

        case 'item/started':
          setActivity((current) => upsertActivity(current, params, 'running'));
          return;

        case 'item/completed': {
          const item = params.item as { id?: string; type?: string; text?: string } | undefined;
          if (item?.type === 'agentMessage') {
            // A turn can produce several replies: one saying what it is about
            // to do, then the answer. Show each as it settles instead of
            // waiting for the turn to end, or the transcript goes blank in the
            // middle of a long task.
            setStreaming('');
            setMessages((current) => [...current, settledAssistantMessage(item)]);
            return;
          }
          setActivity((current) => upsertActivity(current, params, 'done'));
          return;
        }

        case 'turn/completed':
          setRunning(false);
          setStreaming('');
          if (activeRef.current) void loadConversation(activeRef.current, true);
          void refreshConversations();
          return;

        case 'error':
          setError(String((params.error as { message?: string } | undefined)?.message ?? 'Codex báo lỗi'));
          return;

        case 'gateway/approval.requested':
          setApprovals((current) => [...current, params as unknown as Approval]);
          return;

        case 'gateway/approval.resolved': {
          const resolved = params as unknown as Approval;
          setApprovals((current) => current.filter((approval) => approval.id !== resolved.id));
          return;
        }

        default:
          return;
      }
    },
    [loadConversation, refreshConversations],
  );

  const socketState = useGatewaySocket({
    token,
    conversationId: activeId,
    onEvent,
    onQuota: setQuota,
  });

  async function createConversation(projectId: string | null) {
    try {
      const created = await api.createConversation('', projectId);
      setConversations((current) => [created, ...current]);
      setActiveId(created.id);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function removeConversation(id: string) {
    try {
      await api.deleteConversation(id);
      setConversations((current) => current.filter((conversation) => conversation.id !== id));
      if (activeId === id) setActiveId(null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function send(text: string) {
    if (!activeId) return;

    // Shown immediately: the reply streams in, but the prompt should not wait
    // for a round trip to appear.
    setMessages((current) => [...current, optimisticUserMessage(text)]);
    setRunning(true);

    // Name the conversation after its opening line. Without this every row in
    // the sidebar reads the same and the list stops being navigable.
    if (active && !active.title) {
      const title = titleFrom(text);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeId ? { ...conversation, title } : conversation,
        ),
      );
      void api.renameConversation(activeId, title).catch(() => undefined);
    }

    try {
      await api.send(activeId, text, active?.mode);
    } catch (caught) {
      setError((caught as Error).message);
      setRunning(false);
      void loadConversation(activeId);
    }
  }

  /**
   * Applied on the next message rather than immediately: the gateway records
   * the mode when a turn starts, so changing it mid-turn would be a lie.
   */
  function changeMode(mode: ChatMode) {
    if (!activeId) return;
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeId ? { ...conversation, mode } : conversation,
      ),
    );
  }

  async function interrupt() {
    if (!activeId) return;
    try {
      await api.interrupt(activeId);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function resolveApproval(id: string, decision: ApprovalDecision) {
    setApprovals((current) => current.filter((approval) => approval.id !== id));
    try {
      await api.resolveApproval(id, decision);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function createProject(name: string, workspacePath: string) {
    const created = await api.createProject(name, workspacePath);
    setProjects((current) => [created, ...current]);
    return created;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="dot" data-state={socketState} title={`WebSocket: ${socketState}`} />
          Codex Gateway
        </div>
        <QuotaBadge quota={quota} />
        {user.role === 'admin' && (
          <button
            className="codex-chip"
            data-signed-in={codexSignedIn}
            title="Tài khoản Codex dùng chung cho cả gateway"
            onClick={() => setShowAccount(true)}
          >
            {codexSignedIn ? (codexAccount ?? 'Codex') : 'Codex: chưa đăng nhập'}
          </button>
        )}
        <div className="spacer" />
        <span className="who">{user.email}</span>
        <button className="btn btn-ghost btn-tiny" onClick={onSignOut}>
          Đăng xuất
        </button>
      </header>

      <div className="body">
        <Sidebar
          projects={projects}
          conversations={conversations}
          activeId={activeId}
          onSelect={setActiveId}
          onCreate={createConversation}
          onDelete={removeConversation}
          onCreateProject={createProject}
        />

        <main className="chat">
          {!codexSignedIn && (
            <div className="notice">
              Codex chưa đăng nhập. Quản trị viên cần chạy đăng nhập trước khi gửi tin nhắn.
            </div>
          )}
          {error && (
            <div className="notice" role="alert" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
              {error}{' '}
              <button className="btn btn-ghost btn-tiny" onClick={() => setError(null)}>
                Bỏ qua
              </button>
            </div>
          )}

          {active ? (
            <Chat
              conversation={active}
              messages={messages}
              streaming={streaming}
              activity={activity}
              approvals={approvals}
              running={running}
              modes={modes}
              onSend={send}
              onModeChange={changeMode}
              onInterrupt={interrupt}
              onResolveApproval={resolveApproval}
            />
          ) : (
            <div className="centered">
              Chọn một hội thoại, hoặc tạo mới ở thanh bên.
            </div>
          )}
        </main>
      </div>

      {showAccount && (
        <CodexAccountPanel
          onClose={() => setShowAccount(false)}
          onChanged={() => void reloadCodexState()}
        />
      )}
    </div>
  );
}

function QuotaBadge({ quota }: { quota: Quota | null }) {
  const used = quota?.primary?.usedPercent;
  if (used === undefined) return null;

  return (
    <div className="quota" title="Hạn mức dùng chung của cả gateway">
      <span>hạn mức</span>
      <span className="meter" data-high={used >= 75} data-full={used >= 95}>
        <span style={{ width: `${Math.min(100, Math.max(2, used))}%` }} />
      </span>
      <span>{used}%</span>
      {quota?.limitReached && <span style={{ color: 'var(--danger)' }}>· đã chạm trần</span>}
    </div>
  );
}

/**
 * Folds an item lifecycle notification into the activity feed.
 *
 * Keyed by the item id so `item/started` and `item/completed` update one row
 * rather than stacking two.
 */
function upsertActivity(
  current: ActivityItem[],
  params: Record<string, unknown>,
  status: ActivityItem['status'],
): ActivityItem[] {
  const item = params.item as Record<string, unknown> | undefined;
  const type = typeof item?.type === 'string' ? item.type : null;
  // Messages have their own bubbles, and reasoning carries no detail worth a
  // row of its own — the assistant's reply already summarises it.
  if (!item || !type || SKIPPED_ITEMS.has(type)) return current;

  const entry: ActivityItem = {
    id: String(item.id ?? crypto.randomUUID()),
    turnId: String(params.turnId ?? ''),
    kind: type,
    label: labelFor(type),
    detail: detailFor(type, item),
    status: item.status === 'failed' || item.status === 'declined' ? 'failed' : status,
  };

  const index = current.findIndex((existing) => existing.id === entry.id);
  if (index === -1) return [...current, entry];

  const next = [...current];
  next[index] = entry;
  return next;
}

const SKIPPED_ITEMS = new Set(['agentMessage', 'userMessage', 'reasoning']);

function labelFor(type: string): string {
  switch (type) {
    case 'commandExecution':
      return 'chạy lệnh';
    case 'fileChange':
      return 'sửa file';
    case 'mcpToolCall':
      return 'gọi tool';
    case 'webSearch':
      return 'tìm web';
    case 'reasoning':
      return 'suy luận';
    default:
      return type;
  }
}

function detailFor(type: string, item: Record<string, unknown>): string {
  if (type === 'commandExecution') return String(item.command ?? '');
  if (type === 'fileChange') {
    // kind is an object ({ type: 'add' | 'delete' | 'update' }), not a string.
    // Interpolating it directly renders "[object Object]".
    const changes =
      (item.changes as { path?: string; kind?: { type?: string } }[] | undefined) ?? [];
    return changes.map((change) => `${change.kind?.type ?? '?'} ${change.path ?? ''}`).join('\n');
  }
  if (type === 'webSearch') return String(item.query ?? '');
  return '';
}

/** First line, trimmed to something that fits a sidebar row. */
function titleFrom(text: string): string {
  const [line] = text.trim().split(/\r?\n/);
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

/**
 * A reply that has just finished streaming. Replaced by the stored copy when
 * the turn ends and the history is reloaded.
 */
function settledAssistantMessage(item: { id?: string; text?: string }): Message {
  return {
    id: item.id ?? `live-${Date.now()}`,
    role: 'assistant',
    content: item.text ?? '',
    status: 'completed',
    turnId: null,
    createdAt: new Date().toISOString(),
  };
}

function optimisticUserMessage(text: string): Message {
  return {
    id: `local-${Date.now()}`,
    role: 'user',
    content: text,
    status: 'completed',
    turnId: null,
    createdAt: new Date().toISOString(),
  };
}
