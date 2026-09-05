import { Injectable, Logger } from '@nestjs/common';

/**
 * A held concurrency slot. Releasing twice is harmless, which matters because
 * a slot can be freed either by a completion notification or by the safety
 * timeout below.
 */
export interface TurnTicket {
  readonly userId: string;
  release(): void;
}

/**
 * Frees a slot whose turn never reported completion. Without it a dropped
 * notification would leak capacity for the lifetime of the process.
 */
const MAX_SLOT_HOLD_MS = 15 * 60 * 1000;

/**
 * Rations concurrent Codex turns.
 *
 * Every user of this gateway shares one Codex identity and therefore one quota,
 * so one person opening ten conversations would spend everyone else's
 * allowance. A global ceiling caps total load; a per-user ceiling keeps any
 * single account from filling it.
 *
 * A slot is held for the whole turn, not just the `turn/start` call — that call
 * returns as soon as the turn begins, so releasing there would cap nothing.
 */
@Injectable()
export class TurnQueueService {
  private readonly logger = new Logger(TurnQueueService.name);

  private readonly activeByUser = new Map<string, number>();
  private readonly waiters: { userId: string; admit: () => void }[] = [];
  private readonly byTurn = new Map<string, TurnTicket>();

  private activeTotal = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxPerUser: number,
  ) {}

  /** Waits until this user may start a turn, then returns the held slot. */
  async acquire(userId: string): Promise<TurnTicket> {
    if (this.canStart(userId)) {
      this.take(userId);
      return this.makeTicket(userId);
    }

    this.logger.debug(`User ${userId} is waiting for a turn slot`);
    // pump() takes the slot before waking us. Claiming it here instead would
    // leave a gap in which another caller could take it first.
    await new Promise<void>((resolve) => this.waiters.push({ userId, admit: resolve }));
    return this.makeTicket(userId);
  }

  /**
   * Binds a held slot to the turn it started, so a completion notification can
   * free it later.
   */
  bind(turnId: string, ticket: TurnTicket): void {
    this.byTurn.set(turnId, ticket);
  }

  /** Frees the slot for a finished turn. Unknown ids are ignored. */
  release(turnId: string): void {
    const ticket = this.byTurn.get(turnId);
    if (!ticket) return;

    this.byTurn.delete(turnId);
    ticket.release();
  }

  get stats(): { active: number; waiting: number; capacity: number } {
    return { active: this.activeTotal, waiting: this.waiters.length, capacity: this.maxConcurrent };
  }

  private makeTicket(userId: string): TurnTicket {
    let released = false;

    // release() closes over timer, which is declared below. Safe: it is only
    // ever called from the timer callback or by the caller, both after this
    // function has returned.
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      this.give(userId);
      this.pump();
    };

    const timer = setTimeout(() => {
      this.logger.warn(`Turn slot for ${userId} held over ${MAX_SLOT_HOLD_MS}ms — releasing`);
      release();
    }, MAX_SLOT_HOLD_MS);
    timer.unref();

    return { userId, release };
  }

  private canStart(userId: string): boolean {
    return (
      this.activeTotal < this.maxConcurrent && (this.activeByUser.get(userId) ?? 0) < this.maxPerUser
    );
  }

  private take(userId: string): void {
    this.activeTotal += 1;
    this.activeByUser.set(userId, (this.activeByUser.get(userId) ?? 0) + 1);
  }

  private give(userId: string): void {
    this.activeTotal = Math.max(0, this.activeTotal - 1);

    const remaining = (this.activeByUser.get(userId) ?? 1) - 1;
    if (remaining > 0) this.activeByUser.set(userId, remaining);
    else this.activeByUser.delete(userId);
  }

  /**
   * Admits the first waiter that is allowed to start — not simply the oldest.
   * Skipping over a user who is already at their own limit is what stops one
   * busy account from holding the queue behind them.
   */
  private pump(): void {
    const index = this.waiters.findIndex((waiter) => this.canStart(waiter.userId));
    if (index === -1) return;

    const [waiter] = this.waiters.splice(index, 1);
    this.take(waiter.userId);
    waiter.admit();
  }
}
