import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { CodexModule } from '../codex/codex.module';
import { ProjectsModule } from '../projects/projects.module';
import { RuntimeConfig } from '../config/configuration';
import { ConversationStreamService } from './conversation-stream.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { MessagesService } from './messages.service';
import { CodexEvent, CodexEventSchema } from './schemas/codex-event.schema';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { Message, MessageSchema } from './schemas/message.schema';
import { ThreadLockService } from './thread-lock.service';
import { ThreadRegistryService } from './thread-registry.service';
import { TurnQueueService } from './turn-queue.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: CodexEvent.name, schema: CodexEventSchema },
    ]),
    CodexModule,
    ProjectsModule,
  ],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    MessagesService,
    ConversationStreamService,
    ThreadLockService,
    ThreadRegistryService,
    {
      // Limits come from config so an operator can tune them without a rebuild.
      provide: TurnQueueService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const runtime = config.getOrThrow<RuntimeConfig>('runtime');
        return new TurnQueueService(runtime.maxConcurrentTurns, runtime.maxTurnsPerUser);
      },
    },
  ],
  exports: [
    ConversationsService,
    MessagesService,
    ConversationStreamService,
    ThreadLockService,
    ThreadRegistryService,
  ],
})
export class ConversationsModule {}
