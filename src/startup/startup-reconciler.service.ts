import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { ApprovalStatus } from '../approvals/approval.types';
import { Approval, ApprovalDocument } from '../approvals/schemas/approval.schema';
import { Conversation, ConversationDocument, ConversationStatus } from '../conversations/schemas/conversation.schema';
import { Message, MessageDocument, MessageStatus } from '../conversations/schemas/message.schema';

/**
 * Settles work that was in flight when the gateway last stopped.
 *
 * Turns, replies and approval prompts all live partly in memory: the turn is
 * running inside an app-server this process owns, the reply is waiting for a
 * notification, the prompt is a request Codex is blocked on. A restart ends all
 * three at once, and nothing will ever arrive to close them.
 *
 * Without this a user comes back to a conversation stuck on "running", a reply
 * stuck on "pending", and a prompt that can never be answered — none of which
 * clears on its own. Runs on bootstrap, after the database is connected.
 */
@Injectable()
export class StartupReconcilerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupReconcilerService.name);

  constructor(
    @InjectModel(Conversation.name) private readonly conversations: Model<ConversationDocument>,
    @InjectModel(Message.name) private readonly messages: Model<MessageDocument>,
    @InjectModel(Approval.name) private readonly approvals: Model<ApprovalDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const [turns, replies, prompts] = await Promise.all([
      this.conversations.updateMany(
        { activeTurnId: { $ne: null } },
        { $set: { activeTurnId: null, status: ConversationStatus.Idle } },
      ),
      this.messages.updateMany(
        { status: MessageStatus.Pending },
        { $set: { status: MessageStatus.Interrupted } },
      ),
      // Codex is no longer waiting on these; it moved on when the connection
      // dropped, so they can never be answered.
      this.approvals.updateMany(
        { status: ApprovalStatus.Pending },
        { $set: { status: ApprovalStatus.Abandoned, decidedAt: new Date() } },
      ),
    ]);

    const total = turns.modifiedCount + replies.modifiedCount + prompts.modifiedCount;
    if (total === 0) {
      this.logger.log('Nothing left over from the previous run');
      return;
    }

    this.logger.warn(
      `Settled work interrupted by the last shutdown: ` +
        `${turns.modifiedCount} conversation(s), ${replies.modifiedCount} reply(ies), ` +
        `${prompts.modifiedCount} approval(s)`,
    );
  }
}
