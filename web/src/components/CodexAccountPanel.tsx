'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import type { CodexAdminAuthStatus, CodexLoginMethod, PendingLogin } from '@/lib/types';

/** How often the status is re-read while a login is waiting for a person. */
const POLL_MS = 3000;

/**
 * Switching the Codex account.
 *
 * Codex holds one identity for the whole host, so this is not a per-user
 * setting: whoever signs in here is who every conversation on this gateway
 * runs as, and whose quota it spends. Admin only, which the gateway enforces
 * on its own — this panel simply does not offer itself to anyone else.
 *
 * Signing out first is not required. A login can be started while another
 * account is active, and the switch happens only when someone finishes it, so
 * the gateway keeps working in the meantime.
 */
export function CodexAccountPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<CodexAdminAuthStatus | null>(null);
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const previousAccount = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.codexAdminStatus();
      setStatus(next);
      setPending(next.pendingLogin);

      // The account changed under us: the login just completed.
      const email = next.account?.email ?? null;
      if (previousAccount.current !== null && email !== previousAccount.current) onChanged();
      previousAccount.current = email;
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [onChanged]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Only polls while someone is expected to be finishing a login in a browser.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  async function startLogin(method: CodexLoginMethod) {
    setBusy(true);
    setError(null);
    setCopied(false);

    try {
      const result = await api.startCodexLogin(method);
      setPending(result.login);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.cancelCodexLogin();
      setPending(null);
      await refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await api.codexLogout();
      setPending(null);
      await refresh();
      onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!pending) return;
    try {
      await navigator.clipboard.writeText(pending.url);
      setCopied(true);
    } catch {
      setError('Trình duyệt không cho sao chép. Hãy chọn và copy thủ công.');
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Tài khoản Codex">
      <div className="panel">
        <div className="panel-head">
          <h2>Tài khoản Codex</h2>
          <button className="btn btn-ghost btn-tiny" onClick={onClose}>
            Đóng
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="panel-section">
          <div className="section-head">
            <span>Đang dùng</span>
          </div>
          {status?.authenticated ? (
            <p className="account">
              <strong>{status.account?.email ?? 'không rõ email'}</strong>
              {status.account?.planType && <span className="tag">{status.account.planType}</span>}
            </p>
          ) : (
            <p className="account muted">Chưa đăng nhập tài khoản Codex nào.</p>
          )}
          <p className="fine">
            Codex chỉ giữ <strong>một</strong> tài khoản cho cả máy. Đổi ở đây là đổi cho mọi
            người dùng gateway, và mọi lượt chat sẽ tính vào hạn mức của tài khoản mới.
          </p>
        </div>

        {pending ? (
          <div className="panel-section">
            <div className="section-head">
              <span>Đang chờ đăng nhập</span>
            </div>

            {pending.userCode ? (
              <>
                <p className="fine">
                  Mở đường dẫn dưới đây trên thiết bị bất kỳ, đăng nhập rồi nhập mã này:
                </p>
                <p className="code-big">{pending.userCode}</p>
              </>
            ) : (
              <p className="fine">
                Mở đường dẫn dưới đây và đăng nhập bằng tài khoản ChatGPT bạn muốn chuyển sang.
                Trang này tự cập nhật khi xong.
              </p>
            )}

            <input className="url" readOnly value={pending.url} onFocus={(e) => e.target.select()} />

            <div className="choices">
              <button className="btn btn-primary btn-tiny" onClick={() => window.open(pending.url, '_blank')}>
                Mở trong tab mới
              </button>
              <button className="btn btn-tiny" onClick={copyUrl}>
                {copied ? 'Đã sao chép' : 'Sao chép link'}
              </button>
              <button className="btn btn-danger btn-tiny" onClick={cancel} disabled={busy}>
                Huỷ
              </button>
            </div>

            <p className="fine">Link hết hạn lúc {new Date(pending.expiresAt).toLocaleTimeString()}.</p>
          </div>
        ) : (
          <div className="panel-section">
            <div className="section-head">
              <span>Đổi tài khoản</span>
            </div>
            <div className="choices">
              <button className="btn btn-primary" onClick={() => startLogin('browser')} disabled={busy}>
                Lấy link đăng nhập
              </button>
              <button className="btn" onClick={() => startLogin('deviceCode')} disabled={busy}>
                Dùng mã thiết bị
              </button>
            </div>
            <p className="fine">
              Luồng trình duyệt hoàn tất qua <code>localhost:1455</code> của máy chạy gateway, nên
              chỉ dùng được khi bạn ngồi ngay máy đó. Ở xa thì chọn <strong>mã thiết bị</strong>.
            </p>
          </div>
        )}

        {status?.authenticated && !pending && (
          <div className="panel-section">
            <div className="section-head">
              <span>Đăng xuất</span>
            </div>
            <p className="fine">
              Đăng xuất khiến <strong>mọi người</strong> không chat được cho tới khi có tài khoản
              mới. Muốn đổi tài khoản thì không cần bước này — cứ lấy link ở trên.
            </p>
            <button className="btn btn-danger btn-tiny" onClick={signOut} disabled={busy}>
              Đăng xuất Codex
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
