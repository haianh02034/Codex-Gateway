import { TurnQueueService } from './turn-queue.service';

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('TurnQueueService', () => {
  const build = (maxConcurrent: number, maxPerUser: number) => {
    const queue = new TurnQueueService(maxConcurrent, maxPerUser);
    jest.spyOn(queue['logger'], 'debug').mockImplementation(() => undefined);
    jest.spyOn(queue['logger'], 'warn').mockImplementation(() => undefined);
    return queue;
  };

  it('admits callers up to the global ceiling', async () => {
    const queue = build(2, 2);

    await queue.acquire('alice');
    await queue.acquire('bob');

    expect(queue.stats).toMatchObject({ active: 2, waiting: 0, capacity: 2 });
  });

  it('makes a caller wait once the ceiling is reached', async () => {
    const queue = build(1, 1);
    const first = await queue.acquire('alice');

    let admitted = false;
    void queue.acquire('bob').then(() => {
      admitted = true;
    });
    await settle();

    expect(admitted).toBe(false);
    expect(queue.stats.waiting).toBe(1);

    first.release();
    await settle();

    expect(admitted).toBe(true);
  });

  it('caps a single user below the global ceiling', async () => {
    const queue = build(4, 2);

    await queue.acquire('alice');
    await queue.acquire('alice');

    let third = false;
    void queue.acquire('alice').then(() => {
      third = true;
    });
    await settle();

    // Two of four slots are free, but alice may not have them.
    expect(third).toBe(false);
    expect(queue.stats.active).toBe(2);
  });

  it('lets another user past a queued user who is at their own cap', async () => {
    const queue = build(3, 2);
    const a1 = await queue.acquire('alice');
    await queue.acquire('alice');

    const order: string[] = [];
    void queue.acquire('alice').then(() => order.push('alice-third'));
    await settle();
    void queue.acquire('bob').then(() => order.push('bob-first'));
    await settle();

    // bob queued later but is under his cap, so the free third slot is his.
    expect(order).toEqual(['bob-first']);

    a1.release();
    await settle();
    expect(order).toEqual(['bob-first', 'alice-third']);
  });

  it('frees the slot bound to a turn when that turn completes', async () => {
    const queue = build(1, 1);
    const ticket = await queue.acquire('alice');
    queue.bind('turn-1', ticket);

    expect(queue.stats.active).toBe(1);

    queue.release('turn-1');
    expect(queue.stats.active).toBe(0);
  });

  it('ignores a completion for a turn it does not know', () => {
    const queue = build(1, 1);
    expect(() => queue.release('never-seen')).not.toThrow();
  });

  it('treats a double release as a single one', async () => {
    const queue = build(2, 2);
    const ticket = await queue.acquire('alice');
    queue.bind('turn-1', ticket);

    ticket.release();
    queue.release('turn-1');
    ticket.release();

    // A slot can be freed by a completion notification or by the safety
    // timeout; counting both would hand out capacity that does not exist.
    expect(queue.stats.active).toBe(0);
  });

  it('does not hand the same slot to two callers', async () => {
    const queue = build(1, 1);
    const first = await queue.acquire('alice');

    const admitted: string[] = [];
    void queue.acquire('bob').then(() => admitted.push('bob'));
    void queue.acquire('carol').then(() => admitted.push('carol'));
    await settle();

    first.release();
    await settle();

    expect(admitted).toEqual(['bob']);
    expect(queue.stats.active).toBe(1);
  });
});
