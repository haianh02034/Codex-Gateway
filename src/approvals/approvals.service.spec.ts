import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';

import { AuthUser, UserRole } from '../auth/auth.types';
import { ServerRequestRegistry } from '../codex/app-server/server-request.registry';
import { ConversationsService } from '../conversations/conversations.service';
import { ThreadRegistryService } from '../conversations/thread-registry.service';
import { ApprovalDecision, ApprovalStatus } from './approval.types';
import { ApprovalGatewayEvent, ApprovalsService } from './approvals.service';
import { ApprovalDocument } from './schemas/approval.schema';

const ALICE: AuthUser = { id: '5f2b1c9d8e7a4b3c2d1e0f01', email: 'a@x.com', role: UserRole.User };
const BOB: AuthUser = { id: '5f2b1c9d8e7a4b3c2d1e0f02', email: 'b@x.com', role: UserRole.User };

const CONVERSATION_ID = '6a1b2c3d4e5f60718293a4b5';
const APPROVAL_ID = '6a1b2c3d4e5f60718293a4c6';
const OWNED_THREAD = 'thread-alice';

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Records approval rows in memory and answers findOne like Mongo would. */
class FakeApprovalModel {
  readonly rows: Record<string, unknown>[] = [];

  create(doc: Record<string, unknown>): Promise<unknown> {
    const row = {
      ...doc,
      _id: new Types.ObjectId(APPROVAL_ID),
      get: () => new Date('2026-01-01T00:00:00.000Z'),
      save: function (this: Record<string, unknown>) {
        return Promise.resolve(this);
      },
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }

  findOne(filter: { _id: Types.ObjectId; userId: Types.ObjectId }): Promise<unknown> {
    const row = this.rows.find(
      (r) =>
        (r._id as Types.ObjectId).equals(filter._id) &&
        (r.userId as Types.ObjectId).equals(filter.userId),
    );
    return Promise.resolve(row ?? null);
  }

  findById(id: string): Promise<unknown> {
    return Promise.resolve(this.rows.find((r) => (r._id as Types.ObjectId).toString() === id) ?? null);
  }
}

describe('ApprovalsService', () => {
  let model: FakeApprovalModel;
  let registry: ServerRequestRegistry;
  let service: ApprovalsService;
  let events: ApprovalGatewayEvent[];

  const build = (timeoutMs = 60_000, owner: { conversationId: string; userId: string } | null = {
    conversationId: CONVERSATION_ID,
    userId: ALICE.id,
  }) => {
    model = new FakeApprovalModel();
    registry = new ServerRequestRegistry();
    jest.spyOn(registry['logger'], 'warn').mockImplementation(() => undefined);

    const threads = { resolve: () => Promise.resolve(owner) } as unknown as ThreadRegistryService;
    const conversations = {
      requireOwned: (user: AuthUser) =>
        user.id === ALICE.id
          ? Promise.resolve({ _id: new Types.ObjectId(CONVERSATION_ID) })
          : Promise.reject(new NotFoundException('No such conversation')),
    } as unknown as ConversationsService;
    const config = {
      getOrThrow: () => ({ approvalTimeoutMs: timeoutMs }),
    } as unknown as ConfigService;

    service = new ApprovalsService(
      model as unknown as Model<ApprovalDocument>,
      registry,
      threads,
      conversations,
      config,
    );
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    events = [];
    service.onApprovalEvent((event) => events.push(event));
    service.onModuleInit();
  };

  const askCommand = () =>
    registry.resolve({
      id: 7,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: OWNED_THREAD, command: ['rm', '-rf', 'build'], cwd: '/w' },
    });

  it('claims the approval methods a person can answer', () => {
    build();

    expect(registry.hasResponder('item/commandExecution/requestApproval')).toBe(true);
    expect(registry.hasResponder('item/fileChange/requestApproval')).toBe(true);
    expect(registry.hasResponder('execCommandApproval')).toBe(true);

    // Its response type demands a full permission profile and cannot express a
    // refusal, so a yes/no prompt has nothing to return.
    expect(registry.hasResponder('item/permissions/requestApproval')).toBe(false);
  });

  it('routes the request to the owner and waits', async () => {
    build();
    const pending = askCommand();
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      method: 'gateway/approval.requested',
      conversationId: CONVERSATION_ID,
      userId: ALICE.id,
    });
    expect(events[0].params.detail).toMatchObject({ command: ['rm', '-rf', 'build'] });

    await service.resolve(ALICE, APPROVAL_ID, ApprovalDecision.Allow);
    await expect(pending).resolves.toEqual({ result: { decision: 'accept' } });
  });

  it('maps each decision onto the shape that method expects', async () => {
    build();
    const pending = askCommand();
    await settle();

    await service.resolve(ALICE, APPROVAL_ID, ApprovalDecision.AllowForSession);
    await expect(pending).resolves.toEqual({ result: { decision: 'acceptForSession' } });
  });

  it('uses the ReviewDecision shape for the pre-v2 method', async () => {
    build();
    const pending = registry.resolve({
      id: 8,
      method: 'execCommandApproval',
      params: { conversationId: OWNED_THREAD, command: ['ls'] },
    });
    await settle();

    await service.resolve(ALICE, APPROVAL_ID, ApprovalDecision.Deny);
    await expect(pending).resolves.toEqual({
      result: { decision: { denied: { rejection: 'Declined by the user' } } },
    });
  });

  it('refuses to let another user answer', async () => {
    build();
    const pending = askCommand();
    await settle();

    // Answering someone else's prompt would authorise commands against their
    // files. 404, not 403, for the same reason conversations use it.
    await expect(service.resolve(BOB, APPROVAL_ID, ApprovalDecision.Allow)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    await service.resolve(ALICE, APPROVAL_ID, ApprovalDecision.Deny);
    await expect(pending).resolves.toEqual({
      result: { decision: 'decline' },
    });
  });

  it('rejects a second answer to the same prompt', async () => {
    build();
    const pending = askCommand();
    await settle();

    await service.resolve(ALICE, APPROVAL_ID, ApprovalDecision.Allow);
    await pending;

    await expect(service.resolve(ALICE, APPROVAL_ID, ApprovalDecision.Deny)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('declines when nobody answers in time', async () => {
    build(60);
    const pending = askCommand();

    // The app-server blocks on this call, so silence is the one answer that
    // must never happen.
    await expect(pending).resolves.toEqual({ result: { decision: 'decline' } });
    await settle();

    expect(model.rows[0].status).toBe(ApprovalStatus.TimedOut);
  });

  it('declines a request for a thread it cannot attribute', async () => {
    build(60_000, null);

    // Another Codex client on the host: there is nobody here to ask.
    await expect(askCommand()).resolves.toEqual({ result: { decision: 'decline' } });
    expect(model.rows).toHaveLength(0);
  });

  it('emits a resolved event so other viewers stop showing the prompt', async () => {
    build();
    const pending = askCommand();
    await settle();

    await service.resolve(ALICE, APPROVAL_ID, ApprovalDecision.Allow);
    await pending;

    expect(events.map((e) => e.method)).toEqual([
      'gateway/approval.requested',
      'gateway/approval.resolved',
    ]);
    expect(events[1].params.status).toBe(ApprovalStatus.Allowed);
  });
});
