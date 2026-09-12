import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDb, disconnectDb } from './lib/db.js';
import { logger } from './lib/logger.js';

/**
 * Process entrypoint: connect dependencies, then accept traffic.
 *
 * The database connects before `listen` so the first request never meets a
 * half-initialised process. A plain `http.Server` wraps Express so the same
 * server can later carry Socket.IO.
 */
async function main(): Promise<void> {
  await connectDb();

  const app = createApp();
  const server = createServer(app);

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
  });

  /**
   * Render sends SIGTERM on every redeploy. Stop accepting new connections,
   * let in-flight requests finish, then close the database. The timer is a
   * backstop so a hung keep-alive socket cannot block the rollout forever.
   */
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    const force = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000);
    force.unref();

    server.close((err) => {
      if (err) logger.error({ err }, 'Error closing HTTP server');
      disconnectDb()
        .catch((dbErr: unknown) => logger.error({ err: dbErr }, 'Error closing MongoDB'))
        .finally(() => process.exit(err ? 1 : 0));
    });
    server.closeIdleConnections();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
