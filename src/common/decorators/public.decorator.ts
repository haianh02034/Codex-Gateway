import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route out of the globally applied JwtAuthGuard.
 * Authentication is on by default; every use of this is a deliberate hole.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
