import { Model } from 'mongoose';

import { CodexClientService } from '../codex/app-server/codex-client.service';
import { ConversationEvent, ConversationStreamService } from './conversation-stream.service';
import { ConversationsService } from './conversations.service';
import { CodexEventDocument } from './schemas/codex-event.schema';
import { MessageDocument, MessageStatus } from './schemas/message.schema';
import { ThreadRegistryService } from './thread-registry.service';
import { TurnQueueService } from './turn-queue.service';

const CONVERSATION_ID = '6a1b2c3d4e5f60718293a4b5';
// A real ObjectId: the service converts it, so a placeholder string would throw.
const USER_ID = '5f2b1c9d8e7a4b3c2d1e0f01';
const OWNED_THREAD = 'thread-owned';

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('ConversationStreamService', () => {
  let notify: (method: string, params: unknown) => void;
  let messages: { findOneAndUpdate: jest.Mock; updateMany: jest.Mock; create: jest.Mock };
  let codexEvents: { create: jest.Mock };
  let queue: { release: jest.Mock };
  let conversations: { markTurnFinished: jest.Mock };
  let received: ConversationEvent[];

  beforeEach(() => {
    messages = {
      // Resolves to a document by default: the placeholder row created when the
      // turn started is there to be claimed.
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'claimed' }),
      updateMany: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    };
    codexEvents = { create: jest.fn().mockResolvedValue({}) };
    queue = { release: jest.fn() };
    conversations = { markTurnFinished: jest.fn().mockResolvedValue(undefined) };
    received = [];

    const codex = {
      onAny: (listener: (n: { method: string; params: unknown }) => void) => {
        notify = (method, params) => listener({ method, params });
        return () => undefined;
      },
    };

    const registry = {
      resolve: (threadId: string) =>
        Promise.resolve(
          threadId === OWNED_THREAD
            ? { conversationId: CONVERSATION_ID, userId: USER_ID }
            : null,
        ),
    };

    const service = new ConversationStreamService(
      messages as unknown as Model<MessageDocument>,
      codexEvents as unknown as Model<CodexEventDocument>,
      codex as unknown as CodexClientService,
      registry as unknown as ThreadRegistryService,
      conversations as unknown as ConversationsService,
      queue as unknown as TurnQueueService,
    );

    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    service.onModuleInit();
    service.onConversationEvent((event) => received.push(event));
  });

  describe('routing', () => {
    it('attributes a notification to the conversation that owns the thread', async () => {
      notify('item/agentMessage/delta', { threadId: OWNED_THREAD, delta: 'Hel' });
      await settle();

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
        method: 'item/agentMessage/delta',
      });
    });

    it('drops a notification for a thread this gateway does not own', async () => {
      // Another Codex client on the same host. Broadcasting it would leak
      // someone else's command output into this gateway's rooms.
      notify('item/agentMessage/delta', { threadId: 'someone-elses-thread', delta: 'secret' });
      await settle();

      expect(received).toHaveLength(0);
    });

    it('ignores a notification with no thread id', async () => {
      notify('account/rateLimits/updated', { limits: {} });
      await settle();

      expect(received).toHaveLength(0);
    });

    it('passes the protocol method name through unchanged', async () => {
      notify('item/commandExecution/outputDelta', { threadId: OWNED_THREAD, chunk: 'x' });
      await settle();

      expect(received[0].method).toBe('item/commandExecution/outputDelta');
    });
  });

  describe('what gets written', () => {
    it('never persists a delta', async () => {
      for (const chunk of ['Hel', 'lo ', 'world']) {
        notify('item/agentMessage/delta', { threadId: OWNED_THREAD, delta: chunk });
      }
      await settle();

      // Deltas arrive per token; item/completed already carries the full text.
      expect(messages.findOneAndUpdate).not.toHaveBeenCalled();
      expect(codexEvents.create).not.toHaveBeenCalled();
      expect(received).toHaveLength(3);
    });

    it('keeps text streamed before an interrupt', async () => {
      for (const chunk of ['Đang ', 'viết ', 'dở']) {
        notify('item/agentMessage/delta', { threadId: OWNED_THREAD, turnId: 'turn-9', delta: chunk });
      }
      notify('turn/completed', {
        threadId: OWNED_THREAD,
        turn: { id: 'turn-9', status: 'interrupted' },
      });
      await settle();

      // The reader watched this text appear; an empty bubble on reload would
      // be a surprise, and item/completed never arrives for a cut turn.
      expect(messages.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ codexTurnId: 'turn-9', content: '' }),
        { $set: { content: 'Đang viết dở' } },
        { sort: { createdAt: 1 } },
      );
    });

    it('discards the buffer once the item completes normally', async () => {
      notify('item/agentMessage/delta', { threadId: OWNED_THREAD, turnId: 'turn-10', delta: 'partial' });
      notify('item/completed', {
        threadId: OWNED_THREAD,
        turnId: 'turn-10',
        item: { id: 'i', type: 'agentMessage', text: 'the full reply' },
      });
      // Handlers resolve the thread asynchronously, so let them finish before
      // clearing the recorded calls.
      await settle();
      messages.findOneAndUpdate.mockClear();

      notify('turn/completed', {
        threadId: OWNED_THREAD,
        turn: { id: 'turn-10', status: 'completed' },
      });
      await settle();

      // The completed text already won; re-saving the buffer would overwrite
      // a finished reply with a fragment of it.
      expect(messages.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('fills in the pending assistant message when the reply completes', async () => {
      notify('item/completed', {
        threadId: OWNED_THREAD,
        turnId: 'turn-1',
        item: { id: 'item-1', type: 'agentMessage', text: 'Hello world' },
      });
      await settle();

      expect(messages.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ codexTurnId: 'turn-1', status: MessageStatus.Pending }),
        { $set: { content: 'Hello world', status: MessageStatus.Completed, codexItemId: 'item-1' } },
        { sort: { createdAt: 1 } },
      );
    });

    it('keeps a second reply in the same turn instead of dropping it', async () => {
      // A turn that runs tools says what it is about to do, works, then answers.
      // Only one placeholder row exists, so the first message claims it.
      notify('item/completed', {
        threadId: OWNED_THREAD,
        turnId: 'turn-multi',
        item: { id: 'msg-1', type: 'agentMessage', text: 'Mình sẽ tra tài liệu.' },
      });
      await settle();

      // Nothing pending is left for the second one.
      messages.findOneAndUpdate.mockResolvedValue(null);
      notify('item/completed', {
        threadId: OWNED_THREAD,
        turnId: 'turn-multi',
        item: { id: 'msg-2', type: 'agentMessage', text: 'Hạn mức tính theo phiên.' },
      });
      await settle();

      // Updating alone would leave only the preamble and lose the answer.
      expect(messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hạn mức tính theo phiên.',
          codexTurnId: 'turn-multi',
          codexItemId: 'msg-2',
          status: MessageStatus.Completed,
        }),
      );
    });

    it('records a command execution as an event, not a message', async () => {
      notify('item/completed', {
        threadId: OWNED_THREAD,
        turnId: 'turn-1',
        item: { id: 'item-2', type: 'commandExecution', command: 'npm test' },
      });
      await settle();

      expect(messages.findOneAndUpdate).not.toHaveBeenCalled();
      expect(codexEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({ itemType: 'commandExecution', itemId: 'item-2' }),
      );
    });

    it('does not store the user message a second time', async () => {
      // Codex echoes it back as a completed item, but MessagesService already
      // wrote it when the turn was requested.
      notify('item/completed', {
        threadId: OWNED_THREAD,
        turnId: 'turn-1',
        item: { id: 'item-u', type: 'userMessage', text: 'hello' },
      });
      await settle();

      expect(codexEvents.create).not.toHaveBeenCalled();
      expect(messages.findOneAndUpdate).not.toHaveBeenCalled();
      expect(received).toHaveLength(1); // still streamed to the client
    });

    it('keeps streaming even when a write fails', async () => {
      codexEvents.create.mockRejectedValue(new Error('mongo is down'));

      notify('item/completed', {
        threadId: OWNED_THREAD,
        turnId: 'turn-1',
        item: { id: 'item-3', type: 'fileChange' },
      });
      await settle();

      // Losing the audit trail must not also cost the user their live reply.
      expect(received).toHaveLength(1);
    });
  });

  describe('turn completion', () => {
    it('frees the concurrency slot and clears the running turn', async () => {
      notify('turn/completed', {
        threadId: OWNED_THREAD,
        turn: { id: 'turn-1', status: 'completed' },
      });
      await settle();

      expect(queue.release).toHaveBeenCalledWith('turn-1');
      expect(conversations.markTurnFinished).toHaveBeenCalledWith(CONVERSATION_ID, false);
    });

    it('marks an interrupted turn as interrupted rather than failed', async () => {
      notify('turn/completed', {
        threadId: OWNED_THREAD,
        turn: { id: 'turn-2', status: 'interrupted' },
      });
      await settle();

      expect(messages.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ codexTurnId: 'turn-2' }),
        { $set: { status: MessageStatus.Interrupted } },
      );
      expect(conversations.markTurnFinished).toHaveBeenCalledWith(CONVERSATION_ID, false);
    });

    it('marks a failed turn as failed', async () => {
      notify('turn/completed', {
        threadId: OWNED_THREAD,
        turn: { id: 'turn-3', status: 'failed' },
      });
      await settle();

      expect(conversations.markTurnFinished).toHaveBeenCalledWith(CONVERSATION_ID, true);
    });

    it('still frees the slot for a turn that failed', async () => {
      notify('turn/completed', {
        threadId: OWNED_THREAD,
        turn: { id: 'turn-4', status: 'failed' },
      });
      await settle();

      // A leaked slot would permanently shrink the gateway's capacity.
      expect(queue.release).toHaveBeenCalledWith('turn-4');
    });
  });

  describe('errors', () => {
    it('marks pending messages failed when Codex reports a fatal error', async () => {
      notify('error', {
        threadId: OWNED_THREAD,
        turnId: 'turn-5',
        error: { message: 'model unavailable' },
        willRetry: false,
      });
      await settle();

      expect(messages.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ codexTurnId: 'turn-5' }),
        { $set: { status: MessageStatus.Failed, errorMessage: 'model unavailable' } },
      );
    });

    it('ends the turn when the error is fatal', async () => {
      notify('error', {
        threadId: OWNED_THREAD,
        turnId: 'turn-7',
        error: { message: 'unauthorised' },
        willRetry: false,
      });
      await settle();

      // A turn that dies this way never emits turn/completed, so the slot and
      // the conversation state have to be cleared here or they stay stuck.
      expect(queue.release).toHaveBeenCalledWith('turn-7');
      expect(conversations.markTurnFinished).toHaveBeenCalledWith(CONVERSATION_ID, true);
    });

    it('leaves the message alone when Codex will retry', async () => {
      notify('error', {
        threadId: OWNED_THREAD,
        turnId: 'turn-6',
        error: { message: 'rate limited' },
        willRetry: true,
      });
      await settle();

      expect(messages.updateMany).not.toHaveBeenCalled();
    });
  });
});

