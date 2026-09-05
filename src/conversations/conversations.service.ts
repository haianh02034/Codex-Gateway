import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AuthUser } from '../auth/auth.types';
import { CodexClientService, CodexRpcError } from '../codex/app-server/codex-client.service';
import type { ThreadResumeResponse } from '../codex/protocol/generated/v2/ThreadResumeResponse';
import type { ThreadStartResponse } from '../codex/protocol/generated/v2/ThreadStartResponse';
import { Conversation, ConversationDocument, ConversationStatus } from './schemas/conversation.schema';
import { ThreadLockService } from './thread-lock.service';
import { ProjectsService } from '../projects/projects.service';
import { ThreadRegistryService } from './thread-registry.service';

/** A conversation as the API returns it. Never exposes another user's row. */
export interface ConversationView {
  id: string;
  projectId: string | null;
  title: string;
  status: ConversationStatus;
  workspacePath: string;
  model: string | null;
  activeTurnId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResumedConversation extends ConversationView {
  /** Live state from Codex, fetched at resume time. */
  thread: {
    status: string;
    cwd: string;
    model: string;
    turnCount: number;
  };
}

/**
 * Conversations, and the ownership boundary around them.
 *
 * The app-server has no concept of a user. `thread/list` accepts no owner
 * filter and returns every thread on the host, so a client's conversation id is
 * resolved against `userId` here before any thread id is used. A thread id that
 * did not come out of that lookup never reaches Codex.
 *
 * A conversation that belongs to someone else answers 404, not 403: telling a
 * caller that an id exists but is not theirs is itself a disclosure.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversations: Model<ConversationDocument>,
    private readonly codex: CodexClientService,
    private readonly locks: ThreadLockService,
    private readonly registry: ThreadRegistryService,
    private readonly projects: ProjectsService,
  ) {}

  /** Starts a Codex thread in the right directory and records who owns it. */
  async create(
    user: AuthUser,
    title: string,
    projectId: string | null,
  ): Promise<ConversationView> {
    // Resolves the project's directory, or the caller's private one. Throws
    // before any thread exists if the path no longer passes the allowlist.
    const cwd = await this.projects.workspaceFor(user, projectId);

    const response = await this.codex.requestOrUnavailable<ThreadStartResponse>('thread/start', {
      cwd,
      // Requested, but not always granted: Codex silently applies read-only
      // when the platform sandbox is not configured, rather than running
      // unsandboxed. /health/codex reports which one is actually in force.
      sandbox: 'workspace-write',
      // on-request means Codex asks before anything sensitive. Until Phase 5
      // supplies a human, ServerRequestRegistry declines those asks — which is
      // the conservative outcome, not a silent yes.
      approvalPolicy: 'on-request',
    });

    const created = await this.conversations.create({
      userId: new Types.ObjectId(user.id),
      projectId: projectId ? new Types.ObjectId(projectId) : null,
      codexThreadId: response.thread.id,
      title: title.trim(),
      status: ConversationStatus.Idle,
      workspacePath: response.cwd,
      codexModel: response.model,
      activeTurnId: null,
    });

    // Notifications arrive keyed only by threadId, so the mapping has to exist
    // before the first one can be routed.
    this.registry.remember(response.thread.id, {
      conversationId: created._id.toString(),
      userId: user.id,
    });

    this.logger.log(`Conversation ${created._id.toString()} -> thread ${response.thread.id}`);
    return this.toView(created);
  }

  async listForUser(user: AuthUser): Promise<ConversationView[]> {
    const found = await this.conversations
      .find({ userId: new Types.ObjectId(user.id) })
      .sort({ updatedAt: -1 });

    return found.map((conversation) => this.toView(conversation));
  }

  async getForUser(user: AuthUser, id: string): Promise<ConversationView> {
    return this.toView(await this.requireOwned(user, id));
  }

  /**
   * Loads the thread back into the app-server and reports its live state.
   *
   * Separate from the plain read because resuming is a side effect on the Codex
   * side, and a GET should not have one.
   */
  async resume(user: AuthUser, id: string): Promise<ResumedConversation> {
    const conversation = await this.requireOwned(user, id);

    return this.locks.withLock(conversation.codexThreadId, async () => {
      let response: ThreadResumeResponse;
      try {
        response = await this.codex.requestOrUnavailable<ThreadResumeResponse>('thread/resume', {
          threadId: conversation.codexThreadId,
          excludeTurns: true,
        });
      } catch (error) {
        throw this.explainResumeFailure(error, conversation.codexThreadId);
      }

      conversation.codexModel = response.model;
      conversation.workspacePath = response.cwd;
      await conversation.save();

      return {
        ...this.toView(conversation),
        thread: {
          status: response.thread.status.type,
          cwd: response.cwd,
          model: response.model,
          turnCount: response.thread.turns.length,
        },
      };
    });
  }

  /** Deletes the conversation and the Codex thread behind it. */
  async remove(user: AuthUser, id: string): Promise<{ deleted: true }> {
    const conversation = await this.requireOwned(user, id);
    const threadId = conversation.codexThreadId;

    await this.locks.withLock(threadId, async () => {
      try {
        await this.codex.requestOrUnavailable('thread/delete', { threadId });
      } catch (error) {
        // A thread Codex has already lost should not strand the row forever.
        this.logger.warn(
          `Could not delete thread ${threadId}, removing the record anyway: ${(error as Error).message}`,
        );
      }
      await conversation.deleteOne();
      this.registry.forget(threadId);
    });

    this.logger.log(`Deleted conversation ${id} (thread ${threadId})`);
    return { deleted: true };
  }

  /** Records that a turn is running, so it can be interrupted and streamed. */
  async markTurnStarted(conversationId: Types.ObjectId, turnId: string): Promise<void> {
    await this.conversations.updateOne(
      { _id: conversationId },
      { $set: { activeTurnId: turnId, status: ConversationStatus.Running } },
    );
  }

  /**
   * Clears the running turn. Called from the notification stream rather than
   * from the request that started it, because a turn ends asynchronously.
   */
  async markTurnFinished(conversationId: string, failed: boolean): Promise<void> {
    await this.conversations.updateOne(
      { _id: new Types.ObjectId(conversationId) },
      {
        $set: {
          activeTurnId: null,
          status: failed ? ConversationStatus.Failed : ConversationStatus.Idle,
        },
      },
    );
  }

  /**
   * Turns a failed resume into something a caller can act on.
   *
   * Codex only writes a thread to disk once it has content, so a conversation
   * that has never run a turn has no rollout to load and resume fails. That is
   * a normal state, not a fault, and it stops being true after the first
   * message in Phase 4.
   *
   * Anything else becomes a generic 502: Codex error text can carry host paths,
   * and the detail belongs in the log rather than in a response.
   */
  private explainResumeFailure(error: unknown, threadId: string): Error {
    if (!(error instanceof CodexRpcError)) return error as Error;

    this.logger.warn(`thread/resume failed for ${threadId}: ${error.message}`);

    if (error.message.includes('no rollout')) {
      return new ConflictException(
        'This conversation has no history yet. Send a message before resuming it.',
      );
    }

    return new BadGatewayException('Codex could not resume this conversation');
  }

  /**
   * The single gate. Every path that touches a Codex thread goes through here —
   * including MessagesService — so ownership cannot be forgotten in one branch.
   */
  async requireOwned(user: AuthUser, id: string): Promise<ConversationDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('No such conversation');
    }

    const found = await this.conversations.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(user.id),
    });

    if (!found) {
      // Deliberately identical to the missing case. Distinguishing them would
      // confirm that someone else's conversation exists.
      throw new NotFoundException('No such conversation');
    }

    return found;
  }

  private toView(conversation: ConversationDocument): ConversationView {
    return {
      id: conversation._id.toString(),
      projectId: conversation.projectId?.toString() ?? null,
      title: conversation.title,
      status: conversation.status,
      workspacePath: conversation.workspacePath,
      model: conversation.codexModel,
      activeTurnId: conversation.activeTurnId,
      createdAt: (conversation.get('createdAt') as Date | undefined)?.toISOString() ?? '',
      updatedAt: (conversation.get('updatedAt') as Date | undefined)?.toISOString() ?? '',
    };
  }
}
