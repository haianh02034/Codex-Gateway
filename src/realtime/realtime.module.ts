import { Module } from '@nestjs/common';

import { ConversationsModule } from '../conversations/conversations.module';
import { CodexGateway } from './codex.gateway';

/**
 * WebSocket transport for the conversation stream.
 *
 * Kept separate from ConversationsModule so routing and persistence do not
 * depend on how events reach a browser. AuthModule is global, so AuthService
 * is available for handshake authentication without importing it.
 */
@Module({
  imports: [ConversationsModule],
  providers: [CodexGateway],
})
export class RealtimeModule {}
