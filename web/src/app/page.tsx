'use client';

import { useCallback, useEffect, useState } from 'react';

import { Login } from '@/components/Login';
import { Workspace } from '@/components/Workspace';
import { api, session } from '@/lib/api';
import type { AuthUser } from '@/lib/types';

/**
 * Auth gate.
 *
 * The stored token is verified against the gateway before the workspace is
 * shown, rather than trusted because it exists: the gateway resolves every
 * token against the user record, so a disabled account has to fall out here
 * too instead of loading an app that fails on every call.
 */
export default function Page() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = session.get();
    if (!token) {
      setChecking(false);
      return;
    }

    api
      .me()
      .then(setUser)
      .catch(() => session.clear())
      .finally(() => setChecking(false));
  }, []);

  const signOut = useCallback(() => {
    session.clear();
    setUser(null);
  }, []);

  if (checking) {
    return <div className="centered">Đang kiểm tra phiên đăng nhập…</div>;
  }

  if (!user) {
    return <Login onSignedIn={setUser} />;
  }

  return <Workspace user={user} onSignOut={signOut} />;
}
