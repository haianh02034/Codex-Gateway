import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { UserRole } from '../auth.types';

export type UserDocument = HydratedDocument<User>;

/**
 * A user of the gateway.
 *
 * Not a Codex identity: Codex has exactly one of those for the whole host.
 * These rows decide who may sign in and whose conversations are whose.
 */
@Schema({ timestamps: true, collection: 'users' })
export class User {
  // Uniqueness is declared once, on the explicit index below.
  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  /** bcrypt. The plaintext password is never stored or logged. */
  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ required: true, enum: Object.values(UserRole), default: UserRole.User })
  role!: UserRole;

  /**
   * Disabling beats deleting: a token is resolved against this row on every
   * request, so flipping this off ends the user's sessions immediately while
   * their conversations stay attributable.
   */
  @Prop({ required: true, default: true })
  active!: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ email: 1 }, { unique: true });
