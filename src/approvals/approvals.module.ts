import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CodexModule } from '../codex/codex.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { Approval, ApprovalSchema } from './schemas/approval.schema';

/**
 * Turns the server-initiated requests the client layer has been declining
 * since Phase 1 into questions for a person.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Approval.name, schema: ApprovalSchema }]),
    CodexModule,
    ConversationsModule,
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
