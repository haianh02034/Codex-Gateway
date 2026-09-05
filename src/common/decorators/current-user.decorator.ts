import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { AuthUser, RequestWithUser } from '../../auth/auth.types';

/**
 * Injects the authenticated user attached by JwtAuthGuard.
 * Only usable on routes the guard actually protects.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new Error('CurrentUser used on a route that is not behind JwtAuthGuard');
    }
    return request.user;
  },
);
