'use client';

import { useState } from 'react';

import { api, session } from '@/lib/api';
import type { AuthUser } from '@/lib/types';

export function Login({ onSignedIn }: { onSignedIn: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await api.login(email, password);
      session.set(result.accessToken);
      onSignedIn(result.user);
    } catch (caught) {
      // The gateway answers identically for a wrong password and an unknown
      // address, and so does this — repeating its wording rather than guessing.
      setError((caught as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="card" onSubmit={submit}>
        <h1>Codex Gateway</h1>
        <p className="lede">Đăng nhập bằng tài khoản của gateway.</p>

        {error && <div className="error">{error}</div>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Mật khẩu</label>
          <input
            id="password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </main>
  );
}
