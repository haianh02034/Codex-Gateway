import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { AuthConfig } from '../config/configuration';
import { AuthUser, JwtPayload, LoginResult, StoredUser } from './auth.types';
import { USER_STORE, UserStore } from './users/user-store';

/**
 * A valid bcrypt hash of a value nobody knows. Compared against when the email
 * is unknown so a wrong email and a wrong password take the same time, which
 * keeps the login endpoint from confirming which accounts exist.
 */
const DECOY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7Sv0Wjc9WUXVMDbXbCzTQdvHFZ4gRhi';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(USER_STORE) private readonly users: UserStore,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const stored = await this.users.findByEmail(email);
    const matches = await bcrypt.compare(password, stored?.passwordHash ?? DECOY_HASH);

    if (!stored || !matches) {
      this.logger.warn(`Failed login attempt for ${email}`);
      throw new UnauthorizedException('Email or password is incorrect');
    }

    return this.issueToken(stored);
  }

  /**
   * Verifies a bearer token and resolves it against the store, so a token for
   * a deleted or downgraded account stops working immediately rather than
   * staying valid until it expires.
   */
  async verify(token: string): Promise<AuthUser> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Session expired — sign in again');
    }

    const stored = await this.users.findById(payload.sub);
    if (!stored) {
      throw new UnauthorizedException('Account no longer exists');
    }

    return this.toAuthUser(stored);
  }

  private async issueToken(stored: StoredUser): Promise<LoginResult> {
    const user = this.toAuthUser(stored);
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const { jwtExpiresIn } = this.config.getOrThrow<AuthConfig>('auth');

    return {
      accessToken: await this.jwt.signAsync(payload),
      expiresIn: jwtExpiresIn,
      user,
    };
  }

  /** Drops passwordHash. The only path from StoredUser to anything public. */
  private toAuthUser(stored: StoredUser): AuthUser {
    return { id: stored.id, email: stored.email, role: stored.role };
  }
}
