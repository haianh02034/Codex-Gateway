import { NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';

import { AuthUser, UserRole } from '../auth/auth.types';
import { CodexClientService } from '../codex/app-server/codex-client.service';
import { ConversationsService } from './conversations.service';
import { ConversationDocument, ConversationStatus } from './schemas/conversation.schema';
import { ThreadLockService } from './thread-lock.service';
import { ProjectsService } from '../projects/projects.service';
import { ThreadRegistryService } from './thread-registry.service';

const ALICE: AuthUser = {
  id: '5f2b1c9d8e7a4b3c2d1e0f01',
  email: 'alice@example.com',
  role: UserRole.User,
};
const BOB: AuthUser = {
  id: '5f2b1c9d8e7a4b3c2d1e0f02',
  email: 'bob@example.com',
  role: UserRole.User,
};

const ALICE_CONVERSATION_ID = '6a1b2c3d4e5f60718293a4b5';

interface FindOneFilter {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
}

/**
 * Stands in for the Mongoose model and records the filter it was queried with,
 * which is how the ownership check is proven rather than assumed.
 */
class FakeConversationModel {
  readonly findOneFilters: FindOneFilter[] = [];
  deleted = false;

  /** Owned by Alice. Any query carrying a different userId finds nothing. */
  private readonly row = {
    _id: new Types.ObjectId(ALICE_CONVERSATION_ID),
    userId: new Types.ObjectId(ALICE.id),
    codexThreadId: 'thread-alice',
    title: 'Alice notes',
    status: ConversationStatus.Idle,
    workspacePath: '/workspaces',
    codexModel: 'gpt-5-codex',
    activeTurnId: null,
    get: () => new Date('2026-01-01T00:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
    deleteOne: jest.fn().mockImplementation(() => {
      this.deleted = true;
      return Promise.resolve();
    }),
  };

  findOne(filter: FindOneFilter): Promise<unknown> {
    this.findOneFilters.push(filter);

    const matches =
      filter._id.equals(this.row._id) && filter.userId.equals(this.row.userId);

    return Promise.resolve(matches ? this.row : null);
  }

  get aliceRow() {
    return this.row;
  }
}

describe('ConversationsService', () => {
  let model: FakeConversationModel;
  let codex: { requestOrUnavailable: jest.Mock; isConnected: () => boolean };
  let service: ConversationsService;

  beforeEach(() => {
    model = new FakeConversationModel();
    codex = { requestOrUnavailable: jest.fn(), isConnected: () => true };

    const projects = {
      workspaceFor: jest.fn().mockResolvedValue('/workspaces/users/alice'),
    } as unknown as ProjectsService;

    const registry = {
      remember: jest.fn(),
      forget: jest.fn(),
    } as unknown as ThreadRegistryService;

    service = new ConversationsService(
      model as unknown as Model<ConversationDocument>,
      codex as unknown as CodexClientService,
      new ThreadLockService(),
      registry,
      projects,
    );
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  });

  describe('ownership', () => {
    it('lets the owner read their own conversation', async () => {
      await expect(service.getForUser(ALICE, ALICE_CONVERSATION_ID)).resolves.toMatchObject({
        id: ALICE_CONVERSATION_ID,
        title: 'Alice notes',
      });
    });

    it('hides another user conversation behind 404, not 403', async () => {
      // 403 would confirm the id exists. 404 is indistinguishable from a
      // conversation that was never there.
      await expect(service.getForUser(BOB, ALICE_CONVERSATION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('always filters by userId, never by id alone', async () => {
      await service.getForUser(ALICE, ALICE_CONVERSATION_ID).catch(() => undefined);
      await service.getForUser(BOB, ALICE_CONVERSATION_ID).catch(() => undefined);

      expect(model.findOneFilters).toHaveLength(2);
      for (const filter of model.findOneFilters) {
        expect(filter.userId).toBeInstanceOf(Types.ObjectId);
      }
      expect(model.findOneFilters[1].userId.toString()).toBe(BOB.id);
    });

    it('rejects a malformed id without reaching the database', async () => {
      await expect(service.getForUser(ALICE, 'not-an-object-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(model.findOneFilters).toHaveLength(0);
    });

    it('refuses to resume a conversation the caller does not own', async () => {
      await expect(service.resume(BOB, ALICE_CONVERSATION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(codex.requestOrUnavailable).not.toHaveBeenCalled();
    });

    it('refuses to delete a conversation the caller does not own', async () => {
      await expect(service.remove(BOB, ALICE_CONVERSATION_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(codex.requestOrUnavailable).not.toHaveBeenCalled();
      expect(model.deleted).toBe(false);
    });
  });

  describe('resume', () => {
    it('sends the stored thread id, never one supplied by the caller', async () => {
      codex.requestOrUnavailable.mockResolvedValue({
        thread: { status: { type: 'idle' }, turns: [] },
        model: 'gpt-5-codex',
        cwd: '/workspaces',
      });

      await service.resume(ALICE, ALICE_CONVERSATION_ID);

      expect(codex.requestOrUnavailable).toHaveBeenCalledWith('thread/resume', {
        threadId: 'thread-alice',
        excludeTurns: true,
      });
    });
  });

  describe('delete', () => {
    it('removes the row even when Codex has already lost the thread', async () => {
      codex.requestOrUnavailable.mockRejectedValue(new Error('unknown thread'));

      await expect(service.remove(ALICE, ALICE_CONVERSATION_ID)).resolves.toEqual({
        deleted: true,
      });
      expect(model.deleted).toBe(true);
    });
  });
});
