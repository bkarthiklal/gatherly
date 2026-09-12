/**
 * Local MongoDB for development: a single-node replica set, so transactions
 * work exactly as they do on Atlas. Data persists in apps/api/.data/mongo.
 *
 * Usage: pnpm --filter @gatherly/api db:dev
 * Then:  MONGODB_URI=mongodb://127.0.0.1:27017/gatherly?replicaSet=rs0
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const dbPath = fileURLToPath(new URL('../.data/mongo', import.meta.url));
mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port: 27017, dbPath }],
});

console.log(`Dev MongoDB ready: mongodb://127.0.0.1:27017/gatherly?replicaSet=rs0`);

const stop = async () => {
  await replSet.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
