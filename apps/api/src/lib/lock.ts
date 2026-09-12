import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@gatherly/types';
import { AppError } from './errors.js';
import { logger } from './logger.js';
import { getRedis } from './redis.js';

/**
 * Deletes the key only if it still holds our nonce, as one atomic Lua script.
 *
 * The naive release — `DEL key` — has a real failure mode: request A takes
 * the lock, stalls past the TTL (a GC pause, a slow query), the lock expires,
 * request B takes it, then A wakes and deletes B's lock. Now a third request
 * can enter alongside B. Comparing the nonce first closes that hole, and doing
 * the compare and delete in one script means nothing can run in between.
 */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export interface LockOptions {
  /** Auto-expiry, so a crashed holder cannot block everyone forever. */
  ttlMs?: number;
  /** How long to keep retrying before giving up. */
  waitMs?: number;
  redis?: Redis;
  /**
   * What to do if Redis itself is unreachable (as opposed to the lock being
   * taken). 'proceed' runs `fn` unlocked — correct only where the lock is an
   * extra layer and the database enforces the real invariant.
   */
  onUnavailable?: 'fail' | 'proceed';
}

export interface LockHandle {
  key: string;
  nonce: string;
  release: () => Promise<boolean>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function acquireLock(
  key: string,
  options: LockOptions = {},
): Promise<LockHandle | null> {
  const { ttlMs = 5_000, waitMs = 3_000, redis = getRedis() } = options;
  const nonce = randomBytes(16).toString('hex');
  const deadline = Date.now() + waitMs;

  for (let attempt = 0; ; attempt += 1) {
    // SET NX PX: set only if absent, with expiry — one atomic command.
    const ok = await redis.set(key, nonce, 'PX', ttlMs, 'NX');
    if (ok === 'OK') {
      return {
        key,
        nonce,
        release: async () => (await redis.eval(RELEASE_SCRIPT, 1, key, nonce)) === 1,
      };
    }
    if (Date.now() >= deadline) return null;
    // Jittered backoff so waiters do not retry in lockstep.
    await sleep(Math.min(200, 15 * 2 ** Math.min(attempt, 4)) + Math.random() * 15);
  }
}

/** Runs `fn` while holding the lock; always releases, even if `fn` throws. */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  let lock: LockHandle | null;
  try {
    lock = await acquireLock(key, options);
  } catch (err) {
    if (options.onUnavailable !== 'proceed') throw err;
    logger.warn({ err, key }, 'Lock service unavailable; continuing on database guarantees alone');
    return fn();
  }
  if (!lock) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      'Another request for these tickets is in progress — please retry',
    );
  }
  try {
    return await fn();
  } finally {
    // A failed release is harmless: the key expires on its own.
    await lock.release().catch((err: unknown) => logger.warn({ err, key }, 'Lock release failed'));
  }
}
