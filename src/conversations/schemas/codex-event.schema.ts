import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CodexEventDocument = HydratedDocument<CodexEvent>;

/** Completed items expire after a week; they are a debugging aid, not a record. */
const RETENTION_SECONDS = 7 * 24 * 60 * 60;

/**
 * Completed thread items other than the assistant's prose: commands Codex ran,
 * files it changed, tools it called.
 *
 * These are what an IDE-style view renders alongside the reply. They are
 * written from `item/completed` only — never from deltas — and expire on a TTL
 * index, because a full protocol log is not something the gateway should keep
 * forever.
 */
@Schema({ timestamps: true, collection: 'codex_events' })
export class CodexEvent {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Conversation', index: true })
  conversationId!: Types.ObjectId;

  @Prop({ required: true })
  codexTurnId!: string;

  @Prop({ required: true })
  itemId!: string;

  /** ThreadItem discriminator: commandExecution, fileChange, mcpToolCall, ... */
  @Prop({ required: true, index: true })
  itemType!: string;

  @Prop({ required: true, type: Object })
  payload!: Record<string, unknown>;
}

export const CodexEventSchema = SchemaFactory.createForClass(CodexEvent);

CodexEventSchema.index({ conversationId: 1, createdAt: 1 });
CodexEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });
