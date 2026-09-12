import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { acquireLock, withLock } from './lock.js';
import { closeRedis, getRedis } from './redis.js';

afterAll(async () => {
  await closeRedis();
});

const key = () => `test:lock:${randomUUID()}`;

describe('distributed lock', () => {
  it('admits only one holder at a time', async () => {
    const k = key();
    const first = await acquireLock(k, { waitMs: 0 });
    const second = await acquireLock(k, { waitMs: 0 });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await first!.release();
    expect(await acquireLock(k, { waitMs: 0 })).not.toBeNull();
  });

  it('expires on its own so a crashed holder cannot block forever', async () => {
    const k = key();
    await acquireLock(k, { ttlMs: 50, waitMs: 0 });
    await new Promise((r) => setTimeout(r, 80));
    expect(await acquireLock(k, { waitMs: 0 })).not.toBeNull();
  });

  it('never lets a stale holder release a lock someone else now owns', async () => {
    const k = key();
    const stale = await acquireLock(k, { ttlMs: 50, waitMs: 0 });
    await new Promise((r) => setTimeout(r, 80));
    const current = await acquireLock(k, { ttlMs: 5_000, waitMs: 0 });

    expect(await stale!.release()).toBe(false);
    expect(await getRedis().get(k)).toBe(current!.nonce);
  });

  it('serialises concurrent critical sections', async () => {
    const k = key();
    let inside = 0;
    let maxInside = 0;
    await Promise.all(
      Array.from({ length: 25 }, () =>
        withLock(
          k,
          async () => {
            inside += 1;
            maxInside = Math.max(maxInside, inside);
            await new Promise((r) => setTimeout(r, 2));
            inside -= 1;
          },
          { waitMs: 10_000 },
        ),
      ),
    );
    expect(maxInside).toBe(1);
  });

  it('releases the lock when the critical section throws', async () => {
    const k = key();
    await expect(withLock(k, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await getRedis().exists(k)).toBe(0);
  });
});
