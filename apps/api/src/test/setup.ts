import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, inject } from 'vitest';
import { connectDb, disconnectDb } from '../lib/db.js';

// Each test file gets its own database, so files can run in parallel.
beforeAll(async () => {
  await connectDb(inject('mongoUri'), { dbName: `test_${randomUUID().slice(0, 8)}` });
  // Unique indexes must exist before the first write, or duplicate-key tests pass by accident.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterEach(async () => {
  const collections = await mongoose.connection.db?.collections();
  await Promise.all((collections ?? []).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectDb();
});
