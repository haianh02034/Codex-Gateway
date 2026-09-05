import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AuthUser } from '../auth/auth.types';
import { CodexClientService, CodexRpcError } from '../codex/app-server/codex-client.service';
import type { TurnStartResponse } from '../codex/protocol/generated/v2/TurnStartResponse';
import type { UserInput } from '../codex/protocol/generated/v2/UserInput';
import { ConversationsService } from './conversations.service';
import { Message, MessageDocument, MessageRole, MessageStatus } from './schemas/message.schema';
import { ThreadLockService } from './thread-lock.service';
import { TurnQueueService } from './turn-queue.service';

export interface MessageView {
  id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  turnId: string | null;
  createdAt: string;
}

export interface SendMessageResult {
  /** The assistant message that will be filled in as the turn streams. */
  messageId: string;
  turnId: string;
  /** `started` opened a new turn; `steered` joined the one already running. */
  disposition: 'started' | 'steered';
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectModel(Message.name) private readonly messages: Model<MessageDocument>,
    private readonly conversations: ConversationsService,
    private readonly codex: CodexClientService,
    private readonly locks: ThreadLockService,
    private readonly queue: TurnQueueService,
  ) {}

  async list(user: AuthUser, conversationId: string): Promise<MessageView[]> {
    const conversation = await this.conversations.requireOwned(user, conversationId);

    const found = await this.messages
      .find({ conversationId: conversation._id })
      .sort({ createdAt: 1 });

    return found.map((message) => this.toView(message));
  }

  /**
   * Sends a message and returns as soon as the turn is under way. The reply
   * arrives over WebSocket; nothing here waits for the model.
   *
   * A thread runs one turn at a time. When one is already active the text is
   * steered into it rather than queued behind it, so a follow-up reaches the
   * model while it is still working instead of after it has finished.
   */
  async send(user: AuthUser, conversationId: string, text: string): Promise<SendMessageResult> {
    const conversation = await this.conversations.requireOwned(user, conversationId);
    const threadId = conversation.codexThreadId;

    // The lock makes the decision below atomic: without it two requests could
    // both read "no active turn" and each open one on the same thread.
    return this.locks.withLock(threadId, async () => {
      const fresh = await this.conversations.requireOwned(user, conversationId);
      const input: UserInput[] = [{ type: 'text', text, text_elements: [] }];

      await this.messages.create({
        conversationId: fresh._id,
        userId: new Types.ObjectId(user.id),
        role: MessageRole.User,
        content: text,
        status: MessageStatus.Completed,
        codexTurnId: fresh.activeTurnId,
      });

      if (fresh.activeTurnId) {
        return this.steer(user, fresh._id, threadId, fresh.activeTurnId, input);
      }

      return this.start(user, fresh, threadId, input);
    });
  }

  /** Stops the turn currently running on this conversation. */
  async interrupt(user: AuthUser, conversationId: string): Promise<{ interrupted: true }> {
    const conversation = await this.conversations.requireOwned(user, conversationId);

    if (!conversation.activeTurnId) {
      throw new ConflictException('Nothing is running on this conversation');
    }

    // turn/interrupt needs both ids; a conversation that only tracked the
    // thread could never be stopped.
    try {
      await this.codex.requestOrUnavailable('turn/interrupt', {
        threadId: conversation.codexThreadId,
        turnId: conversation.activeTurnId,
      });
    } catch (error) {
      throw await this.reconcileInterrupt(
        error,
        conversation._id.toString(),
        conversation.activeTurnId,
      );
    }

    this.logger.log(`Interrupted turn ${conversation.activeTurnId}`);
    return { interrupted: true };
  }

  /**
   * Handles an interrupt Codex refuses.
   *
   * A turn can end without emitting `turn/completed` — a fatal error during a
   * retry, for example — which leaves this side believing a turn is still
   * running. Rather than report a server fault, clear the stale state so the
   * next request sees the truth.
   */
  private async reconcileInterrupt(
    error: unknown,
    conversationId: string,
    turnId: string,
  ): Promise<Error> {
    if (!(error instanceof CodexRpcError)) return error as Error;

    if (error.message.includes('no active turn')) {
      this.logger.warn(`Conversation ${conversationId} had a stale active turn — clearing it`);

      // Settle the messages too. Clearing only the conversation would leave
      // replies stuck on "pending" with nothing left to complete them.
      await this.messages.updateMany(
        { conversationId: new Types.ObjectId(conversationId), codexTurnId: turnId, status: MessageStatus.Pending },
        { $set: { status: MessageStatus.Interrupted } },
      );
      await this.conversations.markTurnFinished(conversationId, false);

      return new ConflictException('That turn had already finished');
    }

    this.logger.warn(`turn/interrupt failed: ${error.message}`);
    return new ConflictException('Codex could not interrupt this turn');
  }

  private async start(
    user: AuthUser,
    conversation: { _id: Types.ObjectId; codexThreadId: string },
    threadId: string,
    input: UserInput[],
  ): Promise<SendMessageResult> {
    // Held for the whole turn, released when turn/completed arrives. Waiting
    // here is what keeps one user from spending the shared quota alone.
    const ticket = await this.queue.acquire(user.id);

    let response: TurnStartResponse;
    try {
      response = await this.codex.requestOrUnavailable<TurnStartResponse>('turn/start', {
        threadId,
        input,
      });
    } catch (error) {
      ticket.release();
      throw error;
    }

    const turnId = response.turn.id;
    this.queue.bind(turnId, ticket);

    const assistant = await this.messages.create({
      conversationId: conversation._id,
      userId: new Types.ObjectId(user.id),
      role: MessageRole.Assistant,
      content: '',
      status: MessageStatus.Pending,
      codexTurnId: turnId,
    });

    await this.conversations.markTurnStarted(conversation._id, turnId);

    this.logger.log(`Turn ${turnId} started on thread ${threadId}`);
    return { messageId: assistant._id.toString(), turnId, disposition: 'started' };
  }

  private async steer(
    user: AuthUser,
    conversationId: Types.ObjectId,
    threadId: string,
    turnId: string,
    input: UserInput[],
  ): Promise<SendMessageResult> {
    // expectedTurnId is a precondition: if the turn finished between our read
    // and this call, Codex rejects it rather than steering the wrong turn.
    await this.codex.requestOrUnavailable('turn/steer', {
      threadId,
      expectedTurnId: turnId,
      input,
    });

    // No new slot: this rides the turn that already holds one.
    const assistant = await this.messages.create({
      conversationId,
      userId: new Types.ObjectId(user.id),
      role: MessageRole.Assistant,
      content: '',
      status: MessageStatus.Pending,
      codexTurnId: turnId,
    });

    this.logger.log(`Steered into running turn ${turnId}`);
    return { messageId: assistant._id.toString(), turnId, disposition: 'steered' };
  }

  private toView(message: MessageDocument): MessageView {
    return {
      id: message._id.toString(),
      role: message.role,
      content: message.content,
      status: message.status,
      turnId: message.codexTurnId,
      createdAt: (message.get('createdAt') as Date | undefined)?.toISOString() ?? '',
    };
  }
}

