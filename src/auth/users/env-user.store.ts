import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthConfig } from '../../config/configuration';
import { StoredUser, UserRole } from '../auth.types';
import { UserStore } from './user-store';

/**
 * Phase 0 user store: one administrator, seeded from ADMIN_EMAIL and
 * ADMIN_PASSWORD_HASH. There is no registration yet — regular users arrive
 * in Phase 3 together with MongoDB.
 */
@Injectable()
export class EnvUserStore implements UserStore {
  private readonly admin: StoredUser;

  constructor(config: ConfigService) {
    const auth = config.getOrThrow<AuthConfig>('auth');

    this.admin = {
      id: 'admin',
      email: auth.adminEmail.toLowerCase(),
      role: UserRole.Admin,
      passwordHash: auth.adminPasswordHash,
    };
  }

  async findByEmail(email: string): Promise<StoredUser | null> {
    return email.trim().toLowerCase() === this.admin.email ? this.admin : null;
  }

  async findById(id: string): Promise<StoredUser | null> {
    return id === this.admin.id ? this.admin : null;
  }
}
