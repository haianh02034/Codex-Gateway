import { EventEmitter } from 'node:events';

import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AuthUser } from '../auth/auth.types';
import { ServerRequestRegistry } from '../codex/app-server/server-request.registry';
import { WireServerRequest } from '../codex/app-server/wire.types';
import { RuntimeConfig } from '../config/configuration';
import { ConversationsService } from '../conversations/conversations.service';
import { ThreadRegistryService } from '../conversations/thread-registry.service';
import { ApprovalDecision, ApprovalStatus, ApprovalView } from './approval.types';
import { Approval, ApprovalDocument } from './schemas/approval.schema';

/**
 * Methods a person can actually answer, with the decision shape each expects.
 *
 * `item/permissions/requestApproval` is deliberately absent: its response type
 * requires a full granted-permission profile and has no way to express a
 * refusal, so there is nothing a yes/no prompt could return. It keeps falling
 * through to the registry's error reply until that has a proper UI.
 */
const ANSWERABLE: Record<string, (decision: ApprovalDecision) => unknown> = {
  'item/commandExecution/requestApproval': (decision) => ({
    decision:
      decision === ApprovalDecision.Allow
        ? 'accept'
        : decision === ApprovalDecision.AllowForSession
          ? 'acceptForSession'
          : 'decline',
  }),
  'item/fileChange/requestApproval': (decision) => ({
    decision:
      decision === ApprovalDecision.Allow
        ? 'accept'
        : decision === ApprovalDecision.AllowForSession
          ? 'acceptForSession'
          : 'decline',
  }),
  // The pre-v2 pair speaks ReviewDecision, which carries a reason on refusal.
  execCommandApproval: (decision) => ({ decision: toReviewDecision(decision) }),
  applyPatchApproval: (decision) => ({ decision: toReviewDecision(decision) }),
};

function toReviewDecision(decision: ApprovalDecision): unknown {
  if (decision === ApprovalDecision.Allow) return 'approved';
  if (decision === ApprovalDecision.AllowForSession) return 'approved_for_session';
  return { denied: { rejection: 'Declined by the user' } };
}

interface PendingApproval {
  id: string;
  conversationId: string;
  userId: string;
  method: string;
  settle: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
}

export interface ApprovalGatewayEvent {
  conversationId: string;
  userId: string;
  method: 'gateway/approval.requested' | 'gateway/approval.resolved';
  params: ApprovalView;
}

/**
 * Asks a person whether Codex may do something, and answers the app-server.
 *
 * The app-server blocks on these requests, so every path here ends in a reply:
 * a decision, or a decline when nobody answers in time. Requests are routed to
 * the one user who owns the thread — never broadcast — because the payload
 * quotes commands and paths from their workspace.
 */
@Injectable()
export class ApprovalsService implements OnModuleInit {
  private readonly logger = new Logger(ApprovalsService.name);
  private readonly events = new EventEmitter();
  private readonly pending = new Map<string, PendingApproval>();
  private readonly timeoutMs: number;

  constructor(
    @InjectModel(Approval.name) private readonly approvals: Model<ApprovalDocument>,
    private readonly registry: ServerRequestRegistry,
    private readonly threads: ThreadRegistryService,
    private readonly conversations: ConversationsService,
    config: ConfigService,
  ) {
    this.events.setMaxListeners(0);
    this.timeoutMs = config.getOrThrow<RuntimeConfig>('runtime').approvalTimeoutMs;
  }

  onModuleInit(): void {
    for (const method of Object.keys(ANSWERABLE)) {
      this.registry.register(method, (request) => this.ask(method, request));
    }
    this.logger.log(`Handling approvals for ${Object.keys(ANSWERABLE).length} methods`);
  }

  onApprovalEvent(listener: (event: ApprovalGatewayEvent) => void): () => void {
    this.events.on('event', listener);
    return () => {
      this.events.off('event', listener);
    };
  }

  async listForConversation(user: AuthUser, conversationId: string): Promise<ApprovalView[]> {
    const conversation = await this.conversations.requireOwned(user, conversationId);

    const found = await this.approvals
      .find({ conversationId: conversation._id })
      .sort({ createdAt: -1 })
      .limit(100);

    return found.map((approval) => this.toView(approval));
  }

  /** Records the decision and unblocks the waiting app-server request. */
  async resolve(
    user: AuthUser,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<ApprovalView> {
    if (!Types.ObjectId.isValid(approvalId)) {
      throw new NotFoundException('No such approval');
    }

    // Scoped by userId for the same reason conversations are: answering
    // someone else's prompt would let a stranger authorise work on their files.
    const approval = await this.approvals.findOne({
      _id: new Types.ObjectId(approvalId),
      userId: new Types.ObjectId(user.id),
    });

    if (!approval) throw new NotFoundException('No such approval');

    if (approval.status !== ApprovalStatus.Pending) {
      throw new NotFoundException('That approval has already been answered');
    }

    const waiting = this.pending.get(approvalId);
    if (!waiting) {
      // The gateway restarted, or the turn ended. Codex is no longer waiting.
      await this.settleRecord(approval, ApprovalStatus.Abandoned);
      throw new NotFoundException('Codex is no longer waiting on that approval');
    }

    waiting.settle(decision);
    const updated = await this.settleRecord(approval, statusFor(decision));

    this.emit('gateway/approval.resolved', updated);
    return this.toView(updated);
  }

  /**
   * Called by the client layer when the app-server asks for permission.
   * Resolves with whatever the user decides, or a decline on timeout.
   */
  private async ask(method: string, request: WireServerRequest): Promise<unknown> {
    const toResponse = ANSWERABLE[method];
    const params = (request.params ?? {}) as Record<string, unknown>;
    const threadId = this.threadIdOf(params);

    const owner = threadId ? await this.threads.resolve(threadId) : null;
    if (!owner) {
      // A thread this gateway does not own, or one it has lost. There is no
      // one to ask, so refuse rather than guess.
      this.logger.warn(`Declining ${method}: no owner for thread ${threadId ?? 'unknown'}`);
      return toResponse(ApprovalDecision.Deny);
    }

    const expiresAt = new Date(Date.now() + this.timeoutMs);
    const record = await this.approvals.create({
      conversationId: new Types.ObjectId(owner.conversationId),
      userId: new Types.ObjectId(owner.userId),
      requestId: String(request.id),
      method,
      codexTurnId: typeof params.turnId === 'string' ? params.turnId : null,
      detail: params,
      status: ApprovalStatus.Pending,
      expiresAt,
    });

    const id = record._id.toString();
    this.logger.log(`Approval ${id} (${method}) awaiting ${owner.userId}`);
    this.emit('gateway/approval.requested', record);

    const decision = await this.waitForDecision(id, owner, method);
    return toResponse(decision);
  }

  private waitForDecision(
    id: string,
    owner: { conversationId: string; userId: string },
    method: string,
  ): Promise<ApprovalDecision> {
    return new Promise<ApprovalDecision>((resolve) => {
      const finish = (decision: ApprovalDecision) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        resolve(decision);
      };

      const timer = setTimeout(() => {
        this.logger.warn(`Approval ${id} timed out after ${this.timeoutMs}ms — declining`);
        void this.timeOut(id);
        finish(ApprovalDecision.Deny);
      }, this.timeoutMs);

      this.pending.set(id, {
        id,
        conversationId: owner.conversationId,
        userId: owner.userId,
        method,
        settle: finish,
        timer,
      });
    });
  }

  private async timeOut(id: string): Promise<void> {
    const approval = await this.approvals.findById(id);
    if (!approval || approval.status !== ApprovalStatus.Pending) return;

    const updated = await this.settleRecord(approval, ApprovalStatus.TimedOut);
    this.emit('gateway/approval.resolved', updated);
  }

  private async settleRecord(
    approval: ApprovalDocument,
    status: ApprovalStatus,
  ): Promise<ApprovalDocument> {
    approval.status = status;
    approval.decidedAt = new Date();
    return approval.save();
  }

  private emit(method: ApprovalGatewayEvent['method'], approval: ApprovalDocument): void {
    this.events.emit('event', {
      conversationId: approval.conversationId.toString(),
      userId: approval.userId.toString(),
      method,
      params: this.toView(approval),
    } satisfies ApprovalGatewayEvent);
  }

  /** Approval params carry the thread under one of two names across versions. */
  private threadIdOf(params: Record<string, unknown>): string | null {
    for (const key of ['threadId', 'conversationId']) {
      const value = params[key];
      if (typeof value === 'string' && value) return value;
    }
    return null;
  }

  private toView(approval: ApprovalDocument): ApprovalView {
    return {
      id: approval._id.toString(),
      conversationId: approval.conversationId.toString(),
      method: approval.method,
      status: approval.status,
      detail: approval.detail,
      createdAt: (approval.get('createdAt') as Date | undefined)?.toISOString() ?? '',
      expiresAt: approval.expiresAt.toISOString(),
      decidedAt: approval.decidedAt?.toISOString() ?? null,
    };
  }
}

function statusFor(decision: ApprovalDecision): ApprovalStatus {
  if (decision === ApprovalDecision.Allow) return ApprovalStatus.Allowed;
  if (decision === ApprovalDecision.AllowForSession) return ApprovalStatus.AllowedForSession;
  return ApprovalStatus.Denied;
}
