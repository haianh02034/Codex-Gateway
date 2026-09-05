import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Approval, ApprovalSchema } from '../approvals/schemas/approval.schema';
import { Conversation, ConversationSchema } from '../conversations/schemas/conversation.schema';
import { Message, MessageSchema } from '../conversations/schemas/message.schema';
import { InstanceLockService } from './instance-lock.service';
import { StartupReconcilerService } from './startup-reconciler.service';

/**
 * What has to happen before the gateway is safe to serve: claim the
 * single-instance lease, then settle whatever the last shutdown interrupted.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Approval.name, schema: ApprovalSchema },
    ]),
  ],
  providers: [InstanceLockService, StartupReconcilerService],
})
export class StartupModule {}
