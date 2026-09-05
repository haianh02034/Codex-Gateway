import { Logger, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/auth.types';
import { ConversationStreamService } from '../conversations/conversation-stream.service';
import { ConversationsService } from '../conversations/conversations.service';

interface JoinPayload {
  conversationId?: unknown;
}

interface SocketData {
  user?: AuthUser;
}

const room = (conversationId: string) => `conversation:${conversationId}`;

/**
 * Live conversation stream.
 *
 * Sockets are authenticated on connect and authorised again on every join: a
 * socket may only enter the room of a conversation the user actually owns, and
 * ownership is re-checked against the database rather than trusted from the
 * client. Events are then emitted per room, never broadcast — the payloads
 * carry command text and file paths from someone's workspace.
 */
@WebSocketGateway({ namespace: '/codex' })
export class CodexGateway implements OnGatewayConnection, OnModuleInit {
  private readonly logger = new Logger(CodexGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly auth: AuthService,
    private readonly conversations: ConversationsService,
    private readonly stream: ConversationStreamService,
  ) {}

  onModuleInit(): void {
    // CORS is applied by ConfiguredIoAdapter in main.ts, because gateway
    // decorator options cannot read configuration.
    this.stream.onConversationEvent((event) => {
      this.server.to(room(event.conversationId)).emit('codex.event', {
        conversationId: event.conversationId,
        method: event.method,
        params: event.params,
      });
    });
  }

  /**
   * Authenticates before the socket is usable. The token comes from the
   * handshake auth payload; a query string would end up in proxy logs.
   */
  async handleConnection(client: Socket): Promise<void> {
    const token = this.tokenFrom(client);

    if (!token) {
      client.emit('codex.error', { message: 'Sign in to continue' });
      client.disconnect(true);
      return;
    }

    try {
      const user = await this.auth.verify(token);
      (client.data as SocketData).user = user;
      client.emit('codex.connected', { userId: user.id });
    } catch {
      client.emit('codex.error', { message: 'Session expired — sign in again' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('conversation.join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinPayload,
  ): Promise<{ joined: boolean; conversationId?: string; error?: string }> {
    const user = (client.data as SocketData).user;
    if (!user) return { joined: false, error: 'Not authenticated' };

    const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : '';
    if (!conversationId) return { joined: false, error: 'conversationId is required' };

    try {
      // Re-checked here, not taken on trust: a socket is long lived and the
      // conversation may have been deleted since it connected.
      await this.conversations.requireOwned(user, conversationId);
    } catch {
      // Same wording as the HTTP side, for the same reason: a different answer
      // would confirm that someone else's conversation exists.
      return { joined: false, error: 'No such conversation' };
    }

    await client.join(room(conversationId));
    this.logger.debug(`${user.email} joined ${conversationId}`);
    return { joined: true, conversationId };
  }

  @SubscribeMessage('conversation.leave')
  async leave(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinPayload,
  ): Promise<{ left: boolean }> {
    const conversationId = typeof payload?.conversationId === 'string' ? payload.conversationId : '';
    if (conversationId) await client.leave(room(conversationId));
    return { left: true };
  }

  private tokenFrom(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: unknown } | undefined;
    if (typeof auth?.token === 'string' && auth.token) return auth.token;

    const header = client.handshake.headers.authorization;
    if (typeof header === 'string') {
      const [scheme, value] = header.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && value) return value;
    }

    return null;
  }
}
