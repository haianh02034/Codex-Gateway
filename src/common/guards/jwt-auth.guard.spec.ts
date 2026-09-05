import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthService } from '../../auth/auth.service';
import { AuthUser, UserRole } from '../../auth/auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';

const user: AuthUser = { id: 'u1', email: 'u@example.com', role: UserRole.User };

interface MockRequest {
  headers: Record<string, string | undefined>;
  user?: AuthUser;
}

// Reflect.getMetadata rejects an undefined target, so the mock context has to
// hand back real objects the way Nest does.
const handler = function route(): void {};
class Controller {}

function contextFor(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => Controller,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let verify: jest.Mock;
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    verify = jest.fn().mockResolvedValue(user);
    reflector = new Reflector();
    guard = new JwtAuthGuard({ verify } as unknown as AuthService, reflector);
  });

  it('rejects a request with no Authorization header', async () => {
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a non-bearer scheme', async () => {
    const context = contextFor({ headers: { authorization: 'Basic abc123' } });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a bearer token and attaches the user to the request', async () => {
    const request: MockRequest = { headers: { authorization: 'Bearer good-token' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('good-token');
    expect(request.user).toEqual(user);
  });

  it('reads the scheme case-insensitively', async () => {
    const request: MockRequest = { headers: { authorization: 'bearer good-token' } };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
  });

  it('skips authentication on a @Public() route', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });
});
