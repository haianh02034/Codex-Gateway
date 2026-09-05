import { EventEmitter } from 'node:events';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import type { GetAccountRateLimitsResponse } from '../protocol/generated/v2/GetAccountRateLimitsResponse';
import type { RateLimitSnapshot } from '../protocol/generated/v2/RateLimitSnapshot';
import { CodexClientService } from '../app-server/codex-client.service';

export interface QuotaWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

/**
 * The gateway's shared allowance, as every user sees it.
 *
 * Not per-user data: Codex holds one identity for the host, so this is one
 * budget everybody spends from. Showing it to all of them is the point — a
 * user who cannot see the shared meter has no way to understand why their turn
 * was throttled by someone else's work.
 */
export interface QuotaView {
  primary: QuotaWindow | null;
  secondary: QuotaWindow | null;
  credits: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
  planType: string | null;
  /** Non-null once a limit has actually been hit, naming which one. */
  limitReached: string | null;
  updatedAt: string | null;
}

const EMPTY: QuotaView = {
  primary: null,
  secondary: null,
  credits: null,
  planType: null,
  limitReached: null,
  updatedAt: null,
};

@Injectable()
export class QuotaService implements OnModuleInit {
  private readonly logger = new Logger(QuotaService.name);
  private readonly events = new EventEmitter();

  private snapshot: QuotaView = EMPTY;

  constructor(private readonly codex: CodexClientService) {
    this.events.setMaxListeners(0);
  }

  onModuleInit(): void {
    this.codex.on('account/rateLimits/updated', (params) => {
      const update = (params as { rateLimits?: RateLimitSnapshot } | undefined)?.rateLimits;
      if (update) this.merge(update);
    });
  }

  /** Last known figures. Cheap: served from memory, never a protocol call. */
  getSnapshot(): QuotaView {
    return this.snapshot;
  }

  onQuotaChanged(listener: (view: QuotaView) => void): () => void {
    this.events.on('changed', listener);
    return () => {
      this.events.off('changed', listener);
    };
  }

  /** Fetches the authoritative figures. Safe to call when Codex is signed out. */
  async refresh(): Promise<QuotaView> {
    try {
      const response =
        await this.codex.requestOrUnavailable<GetAccountRateLimitsResponse>(
          'account/rateLimits/read',
          {},
        );
      this.merge(response.rateLimits, true);
    } catch (error) {
      this.logger.warn(`Could not read rate limits: ${(error as Error).message}`);
    }

    return this.snapshot;
  }

  /**
   * Folds a snapshot into what is already known.
   *
   * Rolling updates are sparse by design: a null field means "unchanged", not
   * "cleared". Replacing wholesale would blank out the plan or the credit
   * balance every time a usage figure moved.
   */
  private merge(incoming: RateLimitSnapshot, authoritative = false): void {
    const previous = this.snapshot;

    const next: QuotaView = {
      primary: toWindow(incoming.primary) ?? previous.primary,
      secondary: toWindow(incoming.secondary) ?? previous.secondary,
      credits: incoming.credits
        ? {
            hasCredits: incoming.credits.hasCredits,
            unlimited: incoming.credits.unlimited,
            balance: incoming.credits.balance,
          }
        : previous.credits,
      planType: incoming.planType ?? previous.planType,
      // Unlike the rest, this one must be able to clear: a full read that no
      // longer reports a limit means the limit is over.
      limitReached: authoritative
        ? (incoming.rateLimitReachedType ?? null)
        : (incoming.rateLimitReachedType ?? previous.limitReached),
      updatedAt: new Date().toISOString(),
    };

    this.snapshot = next;

    if (next.limitReached && next.limitReached !== previous.limitReached) {
      this.logger.warn(`Shared quota limit reached: ${next.limitReached}`);
    }

    this.events.emit('changed', next);
  }
}

function toWindow(window: RateLimitSnapshot['primary']): QuotaWindow | null {
  if (!window) return null;
  return {
    usedPercent: window.usedPercent,
    windowDurationMins: window.windowDurationMins,
    resetsAt: window.resetsAt,
  };
}
