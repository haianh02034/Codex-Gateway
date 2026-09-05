import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { RequestWithUser, UserRole } from '../../auth/auth.types';

/**
 * Guards actions whose blast radius is the whole host rather than one account.
 *
 * Codex holds a single machine-global identity, so starting or clearing its
 * login affects every user of this gateway at once. Those routes live under
 * /admin and carry this guard; a regular user must never reach them.
 *
 * Runs after the global JwtAuthGuard, so request.user is already populated.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<RequestWithUser>();

    if (user?.role !== UserRole.Admin) {
      throw new ForbiddenException('This action requires an administrator');
    }

    return true;
  }
}
