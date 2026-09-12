import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * `maxRetriesPerRequest: null` is required by BullMQ for its blocking
 * connections, and harmless for ordinary commands: a command waits for the
 * connection to come back instead of failing after 20 retries.
 */
const baseOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
} as const;

export function createRedis(
  name: string,
  overrides: { commandTimeout?: number; maxRetriesPerRequest?: number } = {},
): Redis {
  const client = new Redis(env.REDIS_URL, {
    ...baseOptions,
    ...overrides,
    connectionName: `gatherly:${name}`,
  });
  client.on('error', (err) => logger.error({ err, client: name }, 'Redis error'));
  return client;
}

let shared: Redis | undefined;

/**
 * Connection for application commands (locks). Queues open their own.
 *
 * Unlike queue connections, these commands time out after two seconds: a
 * request that needs a lock must not hang indefinitely while Redis is
 * unreachable. Callers decide how to degrade.
 */
export function getRedis(): Redis {
  shared ??= createRedis('app', { commandTimeout: 2_000, maxRetriesPerRequest: 1 });
  return shared;
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    const client = shared;
    shared = undefined;
    await client.quit().catch(() => client.disconnect());
  }
}
