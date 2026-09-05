import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CodexModule } from '../codex/codex.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { ThreadLockService } from './thread-lock.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Conversation.name, schema: ConversationSchema }]),
    CodexModule,
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService, ThreadLockService],
  exports: [ConversationsService, ThreadLockService],
})
export class ConversationsModule {}
