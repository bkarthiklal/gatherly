import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { createRedis } from '../lib/redis.js';

/** Names may not contain ':' — BullMQ uses it as its key separator. */
export const QUEUE_NAMES = {
  holdExpiry: 'hold-expiry',
  maintenance: 'maintenance',
  notifications: 'notifications',
  refunds: 'refunds',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Finished jobs are trimmed so Redis memory stays flat. This matters on a
 * managed free tier where memory and command counts are both metered.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

export interface QueueRegistry {
  prefix: string;
  get(name: QueueName): Queue;
  close(): Promise<void>;
}

export function createQueueRegistry(prefix = env.QUEUE_PREFIX): QueueRegistry {
  let connection: Redis | undefined;
  const queues = new Map<QueueName, Queue>();

  return {
    prefix,
    get(name) {
      let queue = queues.get(name);
      if (!queue) {
        connection ??= createRedis('queue-producer');
        queue = new Queue(name, { connection, prefix, defaultJobOptions: DEFAULT_JOB_OPTIONS });
        queues.set(name, queue);
      }
      return queue;
    },
    async close() {
      await Promise.all([...queues.values()].map((q) => q.close()));
      queues.clear();
      if (connection) {
        const c = connection;
        connection = undefined;
        await c.quit().catch(() => c.disconnect());
      }
    },
  };
}

/** Job ids are derived from the hold id so re-scheduling the same hold is a no-op. */
export function holdExpiryJobId(holdId: string): string {
  return `hold-expiry-${holdId}`;
}

export async function scheduleHoldExpiry(
  registry: QueueRegistry,
  holdId: string,
  expiresAt: Date,
): Promise<void> {
  await registry.get(QUEUE_NAMES.holdExpiry).add(
    'expire',
    { holdId },
    {
      jobId: holdExpiryJobId(holdId),
      // A small grace period so the job never runs a hair before the deadline
      // and finds the hold "not yet expired".
      delay: Math.max(0, expiresAt.getTime() - Date.now() + 1_000),
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
    },
  );
}
