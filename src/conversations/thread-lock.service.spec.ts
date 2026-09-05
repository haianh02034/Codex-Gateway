import { ThreadLockService } from './thread-lock.service';

/** Resolves after `ms`, used to force overlapping work. */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ThreadLockService', () => {
  let locks: ThreadLockService;

  beforeEach(() => {
    locks = new ThreadLockService();
    jest.spyOn(locks['logger'], 'debug').mockImplementation(() => undefined);
  });

  it('runs work on the same thread one at a time', async () => {
    const events: string[] = [];

    const first = locks.withLock('thread-a', async () => {
      events.push('first:start');
      await delay(30);
      events.push('first:end');
    });

    const second = locks.withLock('thread-a', async () => {
      events.push('second:start');
      await delay(5);
      events.push('second:end');
    });

    await Promise.all([first, second]);

    // The second must not begin until the first has finished, or two turns
    // could open on one Codex thread.
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('lets different threads run at the same time', async () => {
    const events: string[] = [];

    await Promise.all([
      locks.withLock('thread-a', async () => {
        events.push('a:start');
        await delay(30);
        events.push('a:end');
      }),
      locks.withLock('thread-b', async () => {
        events.push('b:start');
        await delay(5);
        events.push('b:end');
      }),
    ]);

    // b finishes while a is still running: the lock is per thread, not global.
    expect(events).toEqual(['a:start', 'b:start', 'b:end', 'a:end']);
  });

  it('keeps the queue moving when one caller fails', async () => {
    const failing = locks.withLock('thread-a', () => Promise.reject(new Error('boom')));
    const following = locks.withLock('thread-a', () => Promise.resolve('ran anyway'));

    await expect(failing).rejects.toThrow('boom');
    await expect(following).resolves.toBe('ran anyway');
  });

  it('propagates the result of the work', async () => {
    await expect(locks.withLock('thread-a', () => Promise.resolve(42))).resolves.toBe(42);
  });

  it('releases the thread once the queue drains', async () => {
    await locks.withLock('thread-a', () => Promise.resolve());
    expect(locks.isBusy('thread-a')).toBe(false);
    expect(locks.activeCount).toBe(0);
  });

  it('reports a thread as busy while work is in flight', async () => {
    const running = locks.withLock('thread-a', () => delay(20));

    expect(locks.isBusy('thread-a')).toBe(true);
    expect(locks.isBusy('thread-b')).toBe(false);

    await running;
    expect(locks.isBusy('thread-a')).toBe(false);
  });

  it('does not release the thread while a later caller is still queued', async () => {
    const first = locks.withLock('thread-a', () => delay(20));
    const second = locks.withLock('thread-a', () => delay(20));

    await first;
    // first has finished but second has not: dropping the entry here would let
    // a third caller start alongside second.
    expect(locks.isBusy('thread-a')).toBe(true);

    await second;
    expect(locks.isBusy('thread-a')).toBe(false);
  });
});
