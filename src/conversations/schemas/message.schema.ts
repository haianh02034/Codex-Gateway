import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MessageDocument = HydratedDocument<Message>;

export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
}

export enum MessageStatus {
  /** Created, waiting for Codex to produce it. */
  Pending = 'pending',
  Completed = 'completed',
  Failed = 'failed',
  Interrupted = 'interrupted',
}

/**
 * One turn of the conversation as a person reads it.
 *
 * Only settled text lands here. Token deltas are streamed over WebSocket and
 * never written: they arrive per token, and persisting them would grow this
 * collection by orders of magnitude for text that `item/completed` already
 * carries in full.
 */
@Schema({ timestamps: true, collection: 'messages' })
export class Message {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Conversation', index: true })
  conversationId!: Types.ObjectId;

  /** Denormalised so a message can be authorised without a second lookup. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(MessageRole) })
  role!: MessageRole;

  /**
   * Not `required`: Mongoose treats an empty string as a missing value, and an
   * assistant message is created empty on purpose, then filled in when the
   * turn produces its text.
   */
  @Prop({ type: String, default: '' })
  content!: string;

  @Prop({ required: true, enum: Object.values(MessageStatus), default: MessageStatus.Pending })
  status!: MessageStatus;

  /** The Codex turn this message belongs to. Needed to interrupt it. */
  @Prop({ type: String, default: null })
  codexTurnId!: string | null;

  @Prop({ type: String, default: null })
  codexItemId!: string | null;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Reading a conversation is always "oldest first, this conversation only".
MessageSchema.index({ conversationId: 1, createdAt: 1 });
