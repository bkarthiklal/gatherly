import { Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import { subscribe } from '../lib/domain-events.js';
import { logger } from '../lib/logger.js';
import { createRedis } from '../lib/redis.js';
import {
  expireHold,
  reconcileHeldCounts,
  sweepExpiredHolds,
} from '../services/inventory.service.js';
import { QUEUE_NAMES, scheduleHoldExpiry, type QueueName, type QueueRegistry } from './queues.js';

export type ProcessorMap = Partial<Record<QueueName, Processor>>;

const processors: ProcessorMap = {
  [QUEUE_NAMES.holdExpiry]: async (job) => {
    const { holdId } = job.data as { holdId: string };
    const expired = await expireHold(holdId);
    return { expired };
  },
  [QUEUE_NAMES.maintenance]: async (job) => {
    if (job.name === 'sweep-holds') return { expired: await sweepExpiredHolds() };
    if (job.name === 'reconcile-held') return { corrected: await reconcileHeldCounts() };
    throw new Error(`Unknown maintenance job ${job.name}`);
  },
};

/** Lets other modules (payments, notifications) contribute processors before workers start. */
export function registerProcessor(name: QueueName, processor: Processor): void {
  processors[name] = processor;
}

/**
 * Producer side: runs in every API process. Turning "a hold was created"
 * into "a job fires when it expires" happens here rather than in the
 * reservation code, so a Redis hiccup can never fail a purchase — the
 * sweeper will catch any expiry whose job was not scheduled.
 */
export function wireProducers(registry: QueueRegistry): () => void {
  return subscribe('hold.created', async ({ holdId, expiresAt }) => {
    await scheduleHoldExpiry(registry, holdId, expiresAt);
  });
}

export interface RunningWorkers {
  close(): Promise<void>;
}

/**
 * Consumer side: starts one BullMQ worker per queue that has a processor and
 * registers the recurring maintenance jobs.
 *
 * Maintenance runs as a BullMQ job scheduler rather than setInterval so that
 * with several processes only one of them runs each tick.
 */
export async function startWorkers(registry: QueueRegistry): Promise<RunningWorkers> {
  const connections: Redis[] = [];
  const workers: Worker[] = [];

  for (const [name, processor] of Object.entries(processors) as [QueueName, Processor][]) {
    const connection = createRedis(`worker-${name}`);
    connections.push(connection);
    const worker = new Worker(name, processor, {
      connection,
      prefix: registry.prefix,
      concurrency: name === QUEUE_NAMES.holdExpiry ? 10 : 5,
      // Poll less aggressively when idle; each empty poll is a metered command on hosted Redis.
      drainDelay: 30,
    });
    worker.on('failed', (job, err) =>
      logger.error({ err, queue: name, jobId: job?.id, attempts: job?.attemptsMade }, 'Job failed'),
    );
    worker.on('error', (err) => logger.error({ err, queue: name }, 'Worker error'));
    workers.push(worker);
  }

  const maintenance = registry.get(QUEUE_NAMES.maintenance);
  await maintenance.upsertJobScheduler('sweep-holds', { every: 60_000 }, { name: 'sweep-holds' });
  await maintenance.upsertJobScheduler(
    'reconcile-held',
    { every: 10 * 60_000 },
    { name: 'reconcile-held' },
  );

  logger.info({ queues: workers.map((w) => w.name) }, 'Background workers started');

  return {
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all(connections.map((c) => c.quit().catch(() => c.disconnect())));
    },
  };
}
