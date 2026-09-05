import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { ApprovalStatus } from '../approval.types';

export type ApprovalDocument = HydratedDocument<Approval>;

/**
 * A request from Codex for permission, and what was decided.
 *
 * Kept after the fact on purpose: these rows are the record of what the agent
 * was allowed to do on someone's workspace, and by whom.
 */
@Schema({ timestamps: true, collection: 'approvals' })
export class Approval {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Conversation', index: true })
  conversationId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  /** The app-server request id this answers. Not unique across restarts. */
  @Prop({ required: true, type: String })
  requestId!: string;

  /** Protocol method, e.g. item/commandExecution/requestApproval. */
  @Prop({ required: true })
  method!: string;

  @Prop({ type: String, default: null })
  codexTurnId!: string | null;

  /** The request payload, shown to whoever decides. */
  @Prop({ required: true, type: Object })
  detail!: Record<string, unknown>;

  @Prop({ required: true, enum: Object.values(ApprovalStatus), default: ApprovalStatus.Pending })
  status!: ApprovalStatus;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  decidedAt!: Date | null;
}

export const ApprovalSchema = SchemaFactory.createForClass(Approval);

ApprovalSchema.index({ conversationId: 1, createdAt: -1 });
// Used to find what is still waiting on a given user.
ApprovalSchema.index({ userId: 1, status: 1 });
