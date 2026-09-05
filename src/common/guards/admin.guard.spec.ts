import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { AuthUser, UserRole } from '../../auth/auth.types';
import { AdminGuard } from './admin.guard';

function contextFor(user: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const admin: AuthUser = { id: 'admin', email: 'a@example.com', role: UserRole.Admin };
const member: AuthUser = { id: 'u1', email: 'u@example.com', role: UserRole.User };

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  it('lets an administrator through', () => {
    expect(guard.canActivate(contextFor(admin))).toBe(true);
  });

  it('rejects a signed-in regular user', () => {
    // Codex login is machine-global: one user logging out would sign out
    // everyone, so a regular account must never reach these routes.
    expect(() => guard.canActivate(contextFor(member))).toThrow(ForbiddenException);
  });

  it('rejects a request with no authenticated user', () => {
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });
});
