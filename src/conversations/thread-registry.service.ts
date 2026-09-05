import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Conversation, ConversationDocument } from './schemas/conversation.schema';

export interface ThreadOwner {
  conversationId: string;
  userId: string;
}

/** Bounded so a long-running gateway cannot grow this without limit. */
const MAX_ENTRIES = 5_000;

/**
 * Maps a Codex thread back to the conversation that owns it.
 *
 * Needed because notifications arrive keyed by `threadId` and nothing else.
 * Token deltas arrive many times per second, so a database round trip per
 * notification is not an option — hence the cache. Entries are recorded when a
 * conversation is created or resumed, and looked up lazily otherwise.
 *
 * Threads started by other Codex clients on the same host resolve to null and
 * are cached as such, so an unrelated thread cannot generate a query storm.
 */
@Injectable()
export class ThreadRegistryService {
  private readonly cache = new Map<string, ThreadOwner | null>();

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversations: Model<ConversationDocument>,
  ) {}

  remember(threadId: string, owner: ThreadOwner): void {
    this.evictIfFull();
    this.cache.set(threadId, owner);
  }

  forget(threadId: string): void {
    this.cache.delete(threadId);
  }

  async resolve(threadId: string): Promise<ThreadOwner | null> {
    const cached = this.cache.get(threadId);
    if (cached !== undefined) return cached;

    const found = await this.conversations.findOne({ codexThreadId: threadId });
    const owner: ThreadOwner | null = found
      ? { conversationId: found._id.toString(), userId: found.userId.toString() }
      : null;

    this.evictIfFull();
    this.cache.set(threadId, owner);
    return owner;
  }

  private evictIfFull(): void {
    if (this.cache.size < MAX_ENTRIES) return;

    const oldest = this.cache.keys().next();
    if (!oldest.done) this.cache.delete(oldest.value);
  }
}
