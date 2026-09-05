/**
 * Roles for the gateway's own users. This is entirely separate from Codex
 * authentication: Codex has one machine-global identity shared by everyone,
 * so only an admin may start or clear that login.
 */
export enum UserRole {
  Admin = 'admin',
  User = 'user',
}

/** A user of this gateway, as the rest of the app sees them. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

/** A user record including the secret. Never leaves the store layer. */
export interface StoredUser extends AuthUser {
  passwordHash: string;
}

/** Claims carried by the gateway's JWT. */
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: string;
  user: AuthUser;
}

/** Express `Request` augmented by JwtAuthGuard. */
export interface RequestWithUser {
  user?: AuthUser;
}
