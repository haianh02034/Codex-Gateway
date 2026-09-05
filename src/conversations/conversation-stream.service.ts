import { EventEmitter } from 'node:events';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { CodexClientService } from '../codex/app-server/codex-client.service';
import { ConversationsService } from './conversations.service';
import { CodexEvent, CodexEventDocument } from './schemas/codex-event.schema';
import { Message, MessageDocument, MessageStatus } from './schemas/message.schema';
import { ThreadRegistryService } from './thread-registry.service';
import { TurnQueueService } from './turn-queue.service';

/**
 * One Codex notification, resolved to the conversation it belongs to.
 *
 * The protocol method name is passed through unchanged. With 706 generated
 * bindings, a parallel event vocabulary would be a permanent translation layer
 * to maintain for no gain — the client already knows these names.
 */
export interface ConversationEvent {
  conversationId: string;
  userId: string;
  method: string;
  params: unknown;
}

interface ItemNotification {
  threadId?: string;
  turnId?: string;
  item?: { id?: string; type?: string; text?: string } & Record<string, unknown>;
}

interface TurnNotification {
  threadId?: string;
  turn?: { id?: string; status?: string };
}

/**
 * Turns the app-server's single notification stream into per-conversation
 * events, and records the parts worth keeping.
 *
 * Everything arrives keyed by `threadId` alone, so each notification is
 * resolved through ThreadRegistryService before it can be attributed to a user.
 * A notification for a thread this gateway does not own — another Codex client
 * on the same host — is dropped rather than broadcast.
 */
@Injectable()
export class ConversationStreamService implements OnModuleInit {
  private readonly logger = new Logger(ConversationStreamService.name);
  private readonly events = new EventEmitter();

  constructor(
    @InjectModel(Message.name) private readonly messages: Model<MessageDocument>,
    @InjectModel(CodexEvent.name) private readonly codexEvents: Model<CodexEventDocument>,
    private readonly codex: CodexClientService,
    private readonly registry: ThreadRegistryService,
    private readonly conversations: ConversationsService,
    private readonly queue: TurnQueueService,
  ) {
    this.events.setMaxListeners(0);
  }

  onModuleInit(): void {
    this.codex.onAny((notification) => {
      void this.handle(notification.method, notification.params);
    });
  }

  /** Subscribes to every routed event. The WebSocket gateway is the consumer. */
  onConversationEvent(listener: (event: ConversationEvent) => void): () => void {
    this.events.on('event', listener);
    return () => {
      this.events.off('event', listener);
    };
  }

  private async handle(method: string, params: unknown): Promise<void> {
    const threadId = (params as { threadId?: string } | undefined)?.threadId;
    if (!threadId) return;

    const owner = await this.registry.resolve(threadId);
    if (!owner) return; // A thread belonging to some other client on this host.

    try {
      await this.record(method, params, owner.conversationId);
    } catch (error) {
      // Persistence must never cost the client its live stream.
      this.logger.error(`Could not record ${method}: ${(error as Error).message}`);
    }

    this.events.emit('event', {
      conversationId: owner.conversationId,
      userId: owner.userId,
      method,
      params,
    } satisfies ConversationEvent);
  }

  private async record(method: string, params: unknown, conversationId: string): Promise<void> {
    switch (method) {
      case 'item/completed':
        return this.recordCompletedItem(params as ItemNotification, conversationId);
      case 'turn/completed':
        return this.recordTurnCompleted(params as TurnNotification, conversationId);
      case 'error':
        return this.recordTurnError(params, conversationId);
      default:
        // Deltas and lifecycle chatter stream but are never written: they
        // arrive per token, and item/completed carries the settled text.
        return;
    }
  }

  private async recordCompletedItem(
    params: ItemNotification,
    conversationId: string,
  ): Promise<void> {
    const item = params.item;
    if (!item?.type || !params.turnId) return;

    if (item.type === 'agentMessage') {
      // Fill in the placeholder created when the turn started. A turn can emit
      // several messages, so only one still-pending row is claimed at a time.
      await this.messages.findOneAndUpdate(
        {
          conversationId: new Types.ObjectId(conversationId),
          codexTurnId: params.turnId,
          status: MessageStatus.Pending,
        },
        {
          $set: {
            content: item.text ?? '',
            status: MessageStatus.Completed,
            codexItemId: item.id ?? null,
          },
        },
        { sort: { createdAt: 1 } },
      );
      return;
    }

    // Commands, file changes, tool calls: what an IDE-style view renders
    // beside the reply. TTL-expired after a week.
    await this.codexEvents.create({
      conversationId: new Types.ObjectId(conversationId),
      codexTurnId: params.turnId,
      itemId: item.id ?? '',
      itemType: item.type,
      payload: item,
    });
  }

  private async recordTurnCompleted(
    params: TurnNotification,
    conversationId: string,
  ): Promise<void> {
    const turnId = params.turn?.id;
    const status = params.turn?.status ?? 'completed';
    if (!turnId) return;

    // Free the concurrency slot this turn has held since it started.
    this.queue.release(turnId);

    const failed = status === 'failed';
    const terminal =
      status === 'interrupted'
        ? MessageStatus.Interrupted
        : failed
          ? MessageStatus.Failed
          : MessageStatus.Completed;

    // Any assistant message still pending never received its text.
    await this.messages.updateMany(
      {
        conversationId: new Types.ObjectId(conversationId),
        codexTurnId: turnId,
        status: MessageStatus.Pending,
      },
      { $set: { status: terminal } },
    );

    await this.conversations.markTurnFinished(conversationId, failed);
  }

  private async recordTurnError(params: unknown, conversationId: string): Promise<void> {
    const payload = params as { turnId?: string; error?: { message?: string }; willRetry?: boolean };
    if (!payload.turnId || payload.willRetry) return;

    const message = payload.error?.message ?? 'Codex reported an error';
    this.logger.warn(`Turn ${payload.turnId} failed: ${message}`);

    // A turn that dies this way never emits turn/completed. Without the two
    // calls below the conversation would stay "running" forever and its
    // concurrency slot would be held until the safety timeout.
    this.queue.release(payload.turnId);

    await this.messages.updateMany(
      {
        conversationId: new Types.ObjectId(conversationId),
        codexTurnId: payload.turnId,
        status: MessageStatus.Pending,
      },
      { $set: { status: MessageStatus.Failed, errorMessage: message } },
    );

    await this.conversations.markTurnFinished(conversationId, true);
  }
}
