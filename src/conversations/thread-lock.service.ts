import { Injectable, Logger } from '@nestjs/common';

/**
 * Serialises work per Codex thread.
 *
 * A thread runs one turn at a time. Two requests arriving together must not
 * open two turns on the same thread, so every operation that touches a thread
 * queues behind the previous one.
 *
 * This is the in-process version, which is correct exactly as long as one
 * gateway process owns the thread — the same single-node assumption the
 * app-server's on-disk thread state already forces. Phase 7 swaps in a Redis
 * lock if that ever stops being true.
 */
@Injectable()
export class ThreadLockService {
  private readonly logger = new Logger(ThreadLockService.name);
  private readonly queues = new Map<string, Promise<unknown>>();

  /** Runs `work` once every earlier caller for this thread has finished. */
  async withLock<T>(threadId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(threadId) ?? Promise.resolve();

    if (this.queues.has(threadId)) {
      this.logger.debug(`Queued behind a running operation on thread ${threadId}`);
    }

    // Swallow the predecessor's rejection: one caller failing must not cascade
    // into everyone waiting behind it.
    const run = previous.then(
      () => work(),
      () => work(),
    );

    this.queues.set(threadId, run);

    try {
      return await run;
    } finally {
      // Only clear when nobody queued behind us, or we would drop their turn.
      if (this.queues.get(threadId) === run) {
        this.queues.delete(threadId);
      }
    }
  }

  isBusy(threadId: string): boolean {
    return this.queues.has(threadId);
  }

  /** Number of threads with work in flight. Used by health and tests. */
  get activeCount(): number {
    return this.queues.size;
  }
}
