import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model } from 'mongoose';

import { AuthConfig } from '../../config/configuration';
import { AuthUser, StoredUser, UserRole } from '../auth.types';
import { User, UserDocument } from '../schemas/user.schema';
import { UserStore } from './user-store';

const BCRYPT_COST = 12;

/** A user as the admin API returns them. Never carries the password hash. */
export interface UserSummary extends AuthUser {
  active: boolean;
  createdAt: string;
}

/**
 * The user directory, backed by MongoDB.
 *
 * Replaces the environment-seeded store from Phase 0. The seed administrator
 * still comes from ADMIN_EMAIL and ADMIN_PASSWORD_HASH and is re-applied on
 * every boot, which doubles as the recovery path: change the environment,
 * restart, and access is restored.
 */
@Injectable()
export class UsersService implements UserStore, OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedAdmin();
  }

  /** Inactive users are invisible here, so their sessions stop working at once. */
  async findByEmail(email: string): Promise<StoredUser | null> {
    const found = await this.users.findOne({ email: email.trim().toLowerCase(), active: true });
    return found ? this.toStored(found) : null;
  }

  async findById(id: string): Promise<StoredUser | null> {
    if (!this.isObjectId(id)) return null;
    const found = await this.users.findById(id);
    return found?.active ? this.toStored(found) : null;
  }

  async create(email: string, password: string, role: UserRole): Promise<UserSummary> {
    const normalised = email.trim().toLowerCase();

    if (await this.users.exists({ email: normalised })) {
      throw new ConflictException('That email address is already registered');
    }

    const created = await this.users.create({
      email: normalised,
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      role,
      active: true,
    });

    this.logger.log(`Created ${role} account ${normalised}`);
    return this.toSummary(created);
  }

  async list(): Promise<UserSummary[]> {
    const found = await this.users.find().sort({ createdAt: -1 });
    return found.map((user) => this.toSummary(user));
  }

  /** Disabling ends the user's sessions on their next request. */
  async setActive(id: string, active: boolean): Promise<UserSummary> {
    if (!this.isObjectId(id)) throw new NotFoundException('No such user');

    const updated = await this.users.findByIdAndUpdate(id, { active }, { new: true });
    if (!updated) throw new NotFoundException('No such user');

    this.logger.warn(`${active ? 'Enabled' : 'Disabled'} account ${updated.email}`);
    return this.toSummary(updated);
  }

  private async seedAdmin(): Promise<void> {
    const { adminEmail, adminPasswordHash } = this.config.getOrThrow<AuthConfig>('auth');
    const email = adminEmail.trim().toLowerCase();

    const result = await this.users.updateOne(
      { email },
      {
        $set: {
          email,
          passwordHash: adminPasswordHash,
          role: UserRole.Admin,
          active: true,
        },
      },
      { upsert: true },
    );

    this.logger.log(
      result.upsertedCount > 0
        ? `Seeded administrator ${email}`
        : `Administrator ${email} refreshed from the environment`,
    );
  }

  private toStored(user: UserDocument): StoredUser {
    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      passwordHash: user.passwordHash,
    };
  }

  /** The only path from a document to something the API may return. */
  private toSummary(user: UserDocument): UserSummary {
    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      active: user.active,
      createdAt: (user.get('createdAt') as Date | undefined)?.toISOString() ?? '',
    };
  }

  private isObjectId(value: string): boolean {
    return /^[a-f\d]{24}$/i.test(value);
  }
}
