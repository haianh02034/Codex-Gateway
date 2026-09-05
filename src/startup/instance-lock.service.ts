import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

import { RuntimeConfig } from '../config/configuration';

const COLLECTION = 'gateway_instance';
const LOCK_ID = 'singleton';
const HEARTBEAT_MS = 15_000;
/** A lease older than this belongs to a process that died without releasing. */
const STALE_AFTER_MS = 60_000;

interface LeaseDocument {
  _id: string;
  instanceId: string;
  host: string;
  pid: number;
  heartbeatAt: Date;
}

/**
 * Keeps a second gateway from running against the same Codex home.
 *
 * The blueprint calls for a single node, and this is what makes that a
 * guarantee rather than a note in a README. Two gateways sharing one CODEX_HOME
 * would each spawn their own app-server over the same on-disk thread history,
 * race each other's approval replies, and hand the same conversation two
 * different active turns.
 *
 * The lease lives in MongoDB rather than a lock file so it works across hosts,
 * which is exactly where the mistake would otherwise be easiest to make.
 */
@Injectable()
export class InstanceLockService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InstanceLockService.name);
  private readonly instanceId = randomUUID();
  private readonly allowMultiple: boolean;

  private timer: NodeJS.Timeout | null = null;
  private held = false;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    config: ConfigService,
  ) {
    this.allowMultiple = config.getOrThrow<RuntimeConfig>('runtime').allowMultipleInstances;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.allowMultiple) {
      this.logger.warn(
        'ALLOW_MULTIPLE_INSTANCES is set — the single-node guard is off. ' +
          'Thread history and approvals will race if these instances share a CODEX_HOME.',
      );
      return;
    }

    await this.claim();

    this.timer = setInterval(() => {
      void this.beat();
    }, HEARTBEAT_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (!this.held) return;

    // Releasing on the way out means a restart does not have to wait out the
    // stale window.
    await this.leases().deleteOne({ _id: LOCK_ID, instanceId: this.instanceId });
    this.held = false;
  }

  private async claim(): Promise<void> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_AFTER_MS);

    let result: LeaseDocument | null;
    try {
      result = await this.leases().findOneAndUpdate(
        {
          _id: LOCK_ID,
          // Free, or last touched by a process that is no longer beating.
          $or: [{ heartbeatAt: { $lt: staleBefore } }, { instanceId: this.instanceId }],
        },
        {
          $set: {
            instanceId: this.instanceId,
            host: hostname(),
            pid: process.pid,
            heartbeatAt: now,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
    } catch (error) {
      // A live lease does not match the filter, so the upsert tries to insert
      // a second document under the same _id. That collision *is* the answer:
      // somebody else holds it.
      if (isDuplicateKey(error)) {
        const existing = await this.leases().findOne({ _id: LOCK_ID });

        // A crash leaves a fresh heartbeat behind, and waiting out the stale
        // window would mean a minute of downtime after every hard restart.
        // On the same host the question is answerable directly: is that pid
        // still there?
        if (existing && this.isDeadOnThisHost(existing)) {
          this.logger.warn(
            `Taking over the lease from ${existing.host} (pid ${existing.pid}), which is no longer running`,
          );
          await this.leases().deleteOne({ _id: LOCK_ID, instanceId: existing.instanceId });
          return this.claim();
        }

        throw new Error(this.conflictMessage(existing));
      }
      throw error;
    }

    if (result?.instanceId !== this.instanceId) {
      throw new Error(this.conflictMessage(result));
    }

    this.held = true;
    this.logger.log(`Holding the single-instance lease (${this.instanceId})`);
  }

  private async beat(): Promise<void> {
    try {
      const result = await this.leases().updateOne(
        { _id: LOCK_ID, instanceId: this.instanceId },
        { $set: { heartbeatAt: new Date() } },
      );

      if (result.matchedCount === 0) {
        // Another instance took the lease while this one was stalled. Keeping
        // going would put two gateways on one Codex home.
        this.logger.error('Lost the single-instance lease to another gateway — shutting down');
        this.held = false;
        process.exit(1);
      }
    } catch (error) {
      this.logger.warn(`Could not refresh the instance lease: ${(error as Error).message}`);
    }
  }

  /**
   * Only answerable for a lease taken on this machine — a pid on another host
   * means nothing here, so a remote lease is always treated as live.
   */
  private isDeadOnThisHost(existing: LeaseDocument): boolean {
    if (existing.host !== hostname()) return false;
    if (existing.pid === process.pid) return true;

    try {
      // Signal 0 checks for existence without touching the process.
      process.kill(existing.pid, 0);
      return false;
    } catch (error) {
      // ESRCH: no such process. EPERM: it exists but belongs to someone else.
      return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
  }

  private conflictMessage(existing: LeaseDocument | null): string {
    const who = existing ? `${existing.host} (pid ${existing.pid})` : 'another process';
    return (
      `Another Codex Gateway is already running on ${who}. ` +
      'Two gateways sharing one CODEX_HOME corrupt thread history and race approvals. ' +
      'Stop it first, or set ALLOW_MULTIPLE_INSTANCES=true if they are genuinely isolated.'
    );
  }

  private leases() {
    return this.connection.collection<LeaseDocument>(COLLECTION);
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}
