import { env } from './config/env.js';
import { connectDb, disconnectDb } from './lib/db.js';
import { logger } from './lib/logger.js';
import { closeRedis } from './lib/redis.js';
import { createQueueRegistry } from './jobs/queues.js';
import { startWorkers } from './jobs/workers.js';
import { registerAppModules } from './modules.js';

/**
 * Standalone background worker, for deployments that separate it from the
 * API (set RUN_WORKERS=false on the API). On Render's free tier the API runs
 * the workers in-process instead, because there is no free worker service.
 */
async function main(): Promise<void> {
  await connectDb();
  const registry = createQueueRegistry();
  registerAppModules(registry);
  const workers = await startWorkers(registry);
  logger.info({ env: env.NODE_ENV }, 'Worker process ready');

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'Worker shutting down');
    void (async () => {
      await workers.close();
      await registry.close();
      await closeRedis();
      await disconnectDb();
      process.exit(0);
    })();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
