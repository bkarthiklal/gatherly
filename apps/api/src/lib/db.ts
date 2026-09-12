import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Reject query filters on fields the schema does not declare. Without this,
 * a typo such as `{ emial: x }` silently matches every document.
 */
mongoose.set('strictQuery', true);

export type DbState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting';

const READY_STATES: Record<number, DbState> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function dbState(): DbState {
  return READY_STATES[mongoose.connection.readyState] ?? 'disconnected';
}

let listenersAttached = false;

/**
 * Connects once and returns when the driver has selected a server.
 *
 * The URI must point at a replica set (Atlas M0 is one). Multi-document
 * transactions — which the hold, order and fulfilment flows depend on — are
 * refused by a standalone mongod, so a misconfigured deployment fails at the
 * first purchase rather than at boot. `assertTransactionsSupported` closes
 * that gap by checking at connect time.
 */
export async function connectDb(
  uri: string = env.MONGODB_URI,
  options: { dbName?: string } = {},
): Promise<void> {
  if (!listenersAttached) {
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
    mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
    mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
    listenersAttached = true;
  }

  await mongoose.connect(uri, {
    ...options,
    serverSelectionTimeoutMS: 10_000,
    // Money-moving writes must survive a primary failover.
    writeConcern: { w: 'majority' },
  });

  await assertTransactionsSupported();
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
}

async function assertTransactionsSupported(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection has no database handle');
  const hello = await db.admin().command({ hello: 1 });
  const isReplicaSet = typeof hello.setName === 'string';
  const isMongos = hello.msg === 'isdbgrid';
  if (!isReplicaSet && !isMongos) {
    throw new Error(
      'MongoDB is a standalone server. Transactions require a replica set — use Atlas or `pnpm --filter @gatherly/api db:dev`.',
    );
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
