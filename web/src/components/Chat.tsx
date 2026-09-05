'use client';

import { useEffect, useRef, useState } from 'react';

import type {
  ActivityItem,
  Approval,
  ApprovalDecision,
  Conversation,
  Message,
} from '@/lib/types';

interface Props {
  conversation: Conversation;
  messages: Message[];
  streaming: string;
  activity: ActivityItem[];
  approvals: Approval[];
  running: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onResolveApproval: (id: string, decision: ApprovalDecision) => void;
}

export function Chat({
  conversation,
  messages,
  streaming,
  activity,
  approvals,
  running,
  onSend,
  onInterrupt,
  onResolveApproval,
}: Props) {
  const [draft, setDraft] = useState('');
  const streamRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the reply as it arrives, but stop fighting the user the moment they
  // scroll up to read something earlier.
  useEffect(() => {
    const element = streamRef.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [messages, streaming, activity, approvals]);

  function onScroll() {
    const element = streamRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinned.current = distance < 60;
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    pinned.current = true;
  }

  return (
    <>
      <div className="chat-head">
        <h2>{conversation.title || 'Hội thoại mới'}</h2>
        <span className="path">{conversation.workspacePath}</span>
        <div style={{ flex: 1 }} />
        {conversation.model && <span className="path">{conversation.model}</span>}
      </div>

      <div className="stream" ref={streamRef} onScroll={onScroll}>
        {messages.length === 0 && !streaming && (
          <div className="empty">Gửi tin nhắn đầu tiên để bắt đầu.</div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="msg" data-role={message.role} data-status={message.status}>
            <div className="msg-role">{message.role === 'user' ? 'bạn' : 'codex'}</div>
            <div className="msg-body">{message.content}</div>
          </div>
        ))}

        {activity.map((item) => (
          <div key={item.id} className="activity" data-status={item.status}>
            <div className="activity-label">
              {item.label}
              {item.status === 'running' && ' …'}
              {item.status === 'failed' && ' ✕'}
            </div>
            {item.detail && <div className="activity-detail">{item.detail}</div>}
          </div>
        ))}

        {approvals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            activity={activity}
            onResolve={onResolveApproval}
          />
        ))}

        {streaming && (
          <div className="msg" data-role="assistant">
            <div className="msg-role">codex</div>
            <div className="msg-body caret">{streaming}</div>
          </div>
        )}
      </div>

      <div className="composer">
        <textarea
          value={draft}
          placeholder="Nhắn cho Codex…"
          rows={1}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        {running ? (
          <button className="btn btn-danger" onClick={onInterrupt}>
            Dừng
          </button>
        ) : (
          <button className="btn btn-primary" onClick={submit} disabled={!draft.trim()}>
            Gửi
          </button>
        )}
      </div>
      <div className="hint">
        Enter để gửi · Shift+Enter xuống dòng
        {running && ' · đang chạy, tin nhắn mới sẽ chèn vào lượt hiện tại'}
      </div>
    </>
  );
}

/**
 * A request from Codex to do something the sandbox will not allow on its own.
 *
 * Three choices rather than yes/no: "cả phiên" is what Codex actually offers,
 * and leaving it out would mean approving every command of a long task one at
 * a time.
 */
function ApprovalCard({
  approval,
  activity,
  onResolve,
}: {
  approval: Approval;
  activity: ActivityItem[];
  onResolve: (id: string, decision: ApprovalDecision) => void;
}) {
  const detail = approval.detail as {
    command?: unknown;
    cwd?: unknown;
    reason?: unknown;
    itemId?: unknown;
  };

  // A file-change approval carries no file information of its own — only an
  // itemId. The command it refers to arrived moments earlier as item/started,
  // so pull the text from there rather than showing an empty box and asking
  // someone to approve blind.
  const related = activity.find((item) => item.id === detail.itemId);
  const command =
    typeof detail.command === 'string'
      ? detail.command
      : (related?.detail ?? (detail.command ? JSON.stringify(detail.command) : ''));

  return (
    <div className="approval">
      <h3>Codex xin phép</h3>
      <p>
        {approval.method.includes('fileChange') ? 'Muốn sửa file ngoài phạm vi cho phép' : 'Muốn chạy lệnh'}
        {typeof detail.cwd === 'string' && ` · ${detail.cwd}`}
      </p>
      {command && <pre>{command}</pre>}
      {typeof detail.reason === 'string' && <p>{detail.reason}</p>}
      <div className="choices">
        <button className="btn btn-primary btn-tiny" onClick={() => onResolve(approval.id, 'allow')}>
          Cho phép
        </button>
        <button className="btn btn-tiny" onClick={() => onResolve(approval.id, 'allowForSession')}>
          Cho phép cả phiên
        </button>
        <button className="btn btn-danger btn-tiny" onClick={() => onResolve(approval.id, 'deny')}>
          Từ chối
        </button>
      </div>
    </div>
  );
}
