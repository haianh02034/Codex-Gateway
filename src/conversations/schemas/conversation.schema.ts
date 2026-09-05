import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ConversationDocument = HydratedDocument<Conversation>;

export enum ConversationStatus {
  Idle = 'idle',
  Running = 'running',
  Failed = 'failed',
}

/**
 * A user's conversation, mapped onto one Codex thread.
 *
 * This mapping is the security boundary of the whole gateway. `thread/list`
 * takes no owner filter and returns every thread on the host, so ownership
 * exists here and nowhere else: resolve a conversation by `userId` first, then
 * use the `codexThreadId` it yields. Never take a thread id from a client.
 */
@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  /**
   * UUIDv7 assigned by Codex at thread/start.
   *
   * Codex only writes a thread to disk once it has content, so a thread that
   * never ran a turn cannot be resumed and does not survive an app-server
   * restart. Phase 4 has to cope with a thread that has gone missing by
   * starting a new one and repointing this field.
   */
  @Prop({ required: true, unique: true })
  codexThreadId!: string;

  @Prop({ trim: true, maxlength: 200, default: '' })
  title!: string;

  @Prop({ required: true, enum: Object.values(ConversationStatus), default: ConversationStatus.Idle })
  status!: ConversationStatus;

  /** Directory the thread runs in, recorded as it was at creation time. */
  @Prop({ required: true })
  workspacePath!: string;

  /**
   * Named codexModel, not model: Mongoose Documents already expose a `model`
   * method, and a field of that name shadows it.
   */
  @Prop({ type: String, default: null })
  codexModel!: string | null;

  /**
   * Turn currently running, if any. turn/interrupt needs both the thread id and
   * the turn id, so a conversation that only tracked the thread could never be
   * interrupted. Phase 4 fills this in.
   */
  @Prop({ type: String, default: null })
  activeTurnId!: string | null;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Every list query is "mine, most recent first".
ConversationSchema.index({ userId: 1, updatedAt: -1 });
// Ownership lookups run on the hot path, so they must never scan.
ConversationSchema.index({ codexThreadId: 1 }, { unique: true });
