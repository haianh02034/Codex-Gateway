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

/**
 * Ceiling on buffered partial text per turn. A runaway turn must not be able to
 * grow this without bound.
 */
const MAX_PARTIAL_CHARS = 1_000_000;

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

  /**
   * Text streamed so far for each running turn.
   *
   * Deltas are still never written as they arrive. This exists for the one case
   * where `item/completed` never comes: an interrupted or failed turn. Without
   * it a reader would open the history and find an empty reply where they had
   * just watched text appear. Cleared whenever a turn ends.
   */
  private readonly partialByTurn = new Map<string, string>();

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

  /**
   * Removes and returns whatever text a turn had streamed.
   *
   * Used when a turn ends without Codex telling us — an interrupt for a turn it
   * had already dropped, for instance.
   */
  takePartialText(turnId: string): string {
    const text = this.partialByTurn.get(turnId) ?? '';
    this.partialByTurn.delete(turnId);
    return text;
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
      case 'item/agentMessage/delta':
        this.bufferDelta(params);
        return;
      case 'item/completed':
        return this.recordCompletedItem(params as ItemNotification, conversationId);
      case 'turn/completed':
        return this.recordTurnCompleted(params as TurnNotification, conversationId);
      case 'error':
        return this.recordTurnError(params, conversationId);
      default:
        // Lifecycle chatter streams but is never written.
        return;
    }
  }

  /** Accumulates in memory only. Nothing here touches the database. */
  private bufferDelta(params: unknown): void {
    const payload = params as { turnId?: string; delta?: string };
    if (!payload.turnId || !payload.delta) return;

    const current = this.partialByTurn.get(payload.turnId) ?? '';
    if (current.length >= MAX_PARTIAL_CHARS) return;

    this.partialByTurn.set(payload.turnId, current + payload.delta);
  }

  private async recordCompletedItem(
    params: ItemNotification,
    conversationId: string,
  ): Promise<void> {
    const item = params.item;
    if (!item?.type || !params.turnId) return;

    // Codex echoes the user's own message back as a completed item. It is
    // already in `messages`, written when the turn was requested, so recording
    // it again would store every prompt twice.
    if (item.type === 'userMessage') return;

    if (item.type === 'agentMessage') {
      // The completed text supersedes anything buffered, and the next item in
      // this turn starts from empty.
      this.partialByTurn.delete(params.turnId);

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

    // An interrupted turn never emits item/completed, so the text the reader
    // already watched appear is only in the buffer. Keep it.
    await this.savePartial(conversationId, turnId);

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

  /**
   * Writes buffered text into the reply that was still waiting for it. Runs
   * before the status update, because the row is found by its pending status.
   */
  private async savePartial(conversationId: string, turnId: string): Promise<void> {
    const partial = this.takePartialText(turnId);
    if (!partial) return;

    await this.messages.findOneAndUpdate(
      {
        conversationId: new Types.ObjectId(conversationId),
        codexTurnId: turnId,
        status: MessageStatus.Pending,
        content: '',
      },
      { $set: { content: partial } },
      { sort: { createdAt: 1 } },
    );
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

    await this.savePartial(conversationId, payload.turnId);

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
