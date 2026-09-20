/**
 * Oversell experiment — produces before/after evidence that the
 * locking strategy prevents overselling.
 *
 * Runs the same rush (N buyers, one seat each, against a tier of C seats)
 * through three implementations and records what each one allows:
 *
 *   naive        read the counter, check it in application code, then $inc.
 *                The classic time-of-check / time-of-use race.
 *   atomic-only  the check moved into the database as a guarded update, with
 *                no transaction and no lock.
 *   gatherly     the production reserveSeats(): guarded update inside a
 *                transaction, behind a per-user Redis lock.
 *
 * A second experiment has one user fire many parallel requests against a
 * per-user limit, to show what the transaction and lock add beyond the
 * atomic update.
 *
 * Usage: pnpm --filter @gatherly/api load-test [--buyers 500] [--seats 100] [--runs 5]
 * Output: load-test-results/results.json and load-test-results/results.md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const { values: args } = parseArgs({
  options: {
    buyers: { type: 'string', default: '500' },
    seats: { type: 'string', default: '100' },
    runs: { type: 'string', default: '5' },
    'burst-requests': { type: 'string', default: '20' },
    'per-user-limit': { type: 'string', default: '4' },
  },
});
const BUYERS = Number(args.buyers);
const SEATS = Number(args.seats);
const RUNS = Number(args.runs);
const BURST = Number(args['burst-requests']);
const PER_USER_LIMIT = Number(args['per-user-limit']);

// Environment must be in place before any application module is imported.
const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: replSet.getUri(),
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  TICKET_SIGNING_SECRET: 'c'.repeat(40),
});

const mongoose = (await import('mongoose')).default;
const { connectDb, disconnectDb } = await import('../src/lib/db.js');
const { closeRedis } = await import('../src/lib/redis.js');
const { EventModel } = await import('../src/models/event.model.js');
const { TicketTierModel } = await import('../src/models/ticket-tier.model.js');
const { HoldModel } = await import('../src/models/hold.model.js');
const { UserModel } = await import('../src/models/user.model.js');
const { reserveSeats } = await import('../src/services/inventory.service.js');

await connectDb(replSet.getUri(), { dbName: 'loadtest' });
await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

type Reserve = (
  userId: string,
  tierId: string,
  quantity: number,
  perUserLimit: number,
) => Promise<void>;

class Rejected extends Error {}

// ─── The three implementations ──────────────────────────────────────────────

const naive: Reserve = async (userId, tierId, quantity, perUserLimit) => {
  const tier = await TicketTierModel.findById(tierId).lean();
  if (!tier) throw new Rejected('missing');
  const mine = await HoldModel.countDocuments({ userId, tierId, status: 'active' });
  if (mine + quantity > perUserLimit) throw new Rejected('limit');
  if (tier.quantityTotal - tier.quantitySold - tier.quantityHeld < quantity)
    throw new Rejected('sold out');
  // Between the read above and this write, any number of other requests passed the same check.
  await TicketTierModel.updateOne({ _id: tierId }, { $inc: { quantityHeld: quantity } });
  await HoldModel.create(holdDoc(userId, tier, quantity));
};

const atomicOnly: Reserve = async (userId, tierId, quantity, perUserLimit) => {
  const mine = await HoldModel.countDocuments({ userId, tierId, status: 'active' });
  if (mine + quantity > perUserLimit) throw new Rejected('limit');
  const tier = await TicketTierModel.findOneAndUpdate(
    {
      _id: tierId,
      $expr: {
        $gte: [
          { $subtract: [{ $subtract: ['$quantityTotal', '$quantitySold'] }, '$quantityHeld'] },
          quantity,
        ],
      },
    },
    { $inc: { quantityHeld: quantity } },
  ).lean();
  if (!tier) throw new Rejected('sold out');
  await HoldModel.create(holdDoc(userId, tier, quantity));
};

const gatherly: Reserve = async (userId, tierId, quantity) => {
  await reserveSeats({ userId, role: 'attendee' }, { tierId, quantity });
};

function holdDoc(
  userId: string,
  tier: { _id: unknown; eventId: unknown; name: string; priceMinor: number },
  quantity: number,
) {
  return {
    userId,
    eventId: tier.eventId,
    tierId: tier._id,
    tierName: tier.name,
    quantity,
    unitPriceMinor: tier.priceMinor,
    expiresAt: new Date(Date.now() + 8 * 60 * 1000),
  };
}

const STRATEGIES: Record<string, Reserve> = { naive, 'atomic-only': atomicOnly, gatherly };

// ─── Harness ────────────────────────────────────────────────────────────────

async function freshTier(capacity: number, perUserLimit: number) {
  await Promise.all([
    EventModel.deleteMany({}),
    TicketTierModel.deleteMany({}),
    HoldModel.deleteMany({}),
  ]);
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const event = await EventModel.create({
    organiserId: new mongoose.Types.ObjectId(),
    title: 'Load test',
    slug: `load-${Date.now()}`,
    description: 'Synthetic event for the oversell experiment.',
    category: 'music',
    venue: { name: 'Arena', addressLine: '1 Road', city: 'Pune', cityKey: 'pune' },
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    status: 'published',
  });
  const tier = await TicketTierModel.create({
    eventId: event._id,
    name: 'General',
    priceMinor: 50_000,
    quantityTotal: capacity,
    perUserLimit,
  });
  return tier._id.toString();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

interface RunResult {
  granted: number;
  rejected: number;
  errors: number;
  storedHeld: number;
  activeHolds: number;
  oversold: number;
  durationMs: number;
  p50Ms: number;
  p95Ms: number;
}

async function run(
  reserve: Reserve,
  userIds: string[],
  capacity: number,
  perUserLimit: number,
): Promise<RunResult> {
  const tierId = await freshTier(capacity, perUserLimit);
  const latencies: number[] = [];
  let granted = 0;
  let rejected = 0;
  let errors = 0;

  const started = performance.now();
  await Promise.all(
    userIds.map(async (userId) => {
      const t0 = performance.now();
      try {
        await reserve(userId, tierId, 1, perUserLimit);
        granted += 1;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (err instanceof Rejected || code === 'SOLD_OUT' || code === 'PURCHASE_LIMIT_REACHED')
          rejected += 1;
        else errors += 1;
      } finally {
        latencies.push(performance.now() - t0);
      }
    }),
  );
  const durationMs = performance.now() - started;

  const tier = await TicketTierModel.findById(tierId).lean();
  const activeHolds = await HoldModel.countDocuments({ tierId, status: 'active' });
  latencies.sort((a, b) => a - b);
  return {
    granted,
    rejected,
    errors,
    storedHeld: tier?.quantityHeld ?? 0,
    activeHolds,
    oversold: Math.max(0, activeHolds - capacity),
    durationMs: Math.round(durationMs),
    p50Ms: Math.round(percentile(latencies, 50)),
    p95Ms: Math.round(percentile(latencies, 95)),
  };
}

function summarise(results: RunResult[]) {
  const pick = (k: keyof RunResult) => results.map((r) => r[k]);
  const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    runs: results.length,
    grantedMin: Math.min(...pick('granted')),
    grantedMax: Math.max(...pick('granted')),
    grantedMean: mean(pick('granted')),
    oversoldMax: Math.max(...pick('oversold')),
    errors: pick('errors').reduce((a, b) => a + b, 0),
    durationMsMean: mean(pick('durationMs')),
    p95MsMean: mean(pick('p95Ms')),
    raw: results,
  };
}

// ─── Experiments ────────────────────────────────────────────────────────────

const password = 'x'.repeat(60); // Not a real hash; these accounts never log in.
const buyers = await UserModel.insertMany(
  Array.from({ length: BUYERS }, (_, i) => ({
    name: `Buyer ${i}`,
    email: `b${i}@load.test`,
    passwordHash: password,
  })),
);
const buyerIds = buyers.map((b) => b._id.toString());
const burstUser = buyerIds[0]!;

const output = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    mongodb: '8.2.6 single-node replica set (mongodb-memory-server)',
    redis: process.env.REDIS_URL,
    platform: `${process.platform}/${process.arch}`,
  },
  rush: {
    buyers: BUYERS,
    seats: SEATS,
    runs: RUNS,
    results: {} as Record<string, ReturnType<typeof summarise>>,
  },
  burst: {
    requests: BURST,
    perUserLimit: PER_USER_LIMIT,
    runs: RUNS,
    results: {} as Record<string, ReturnType<typeof summarise>>,
  },
};

for (const [name, reserve] of Object.entries(STRATEGIES)) {
  const rush: RunResult[] = [];
  const burst: RunResult[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    rush.push(await run(reserve, buyerIds, SEATS, BUYERS));
    burst.push(await run(reserve, Array(BURST).fill(burstUser) as string[], SEATS, PER_USER_LIMIT));
  }
  output.rush.results[name] = summarise(rush);
  output.burst.results[name] = summarise(burst);
  console.log(
    `${name.padEnd(12)} rush granted ${output.rush.results[name].grantedMin}–${output.rush.results[name].grantedMax} of ${SEATS} seats` +
      ` | burst granted ${output.burst.results[name].grantedMin}–${output.burst.results[name].grantedMax} (limit ${PER_USER_LIMIT})`,
  );
}

const outDir = fileURLToPath(new URL('../load-test-results/', import.meta.url));
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}results.json`, `${JSON.stringify(output, null, 2)}\n`);

const row = (name: string, s: ReturnType<typeof summarise>, cap: number) =>
  `| ${name} | ${s.grantedMin === s.grantedMax ? s.grantedMin : `${s.grantedMin}–${s.grantedMax}`} | ${cap} | ${s.oversoldMax} | ${s.errors} | ${s.durationMsMean} | ${s.p95MsMean} |`;

writeFileSync(
  `${outDir}results.md`,
  [
    '# Oversell experiment results',
    '',
    `Generated ${output.generatedAt} · Node ${output.environment.node} · ${output.environment.mongodb} · ${output.environment.platform}`,
    '',
    `## Experiment 1 — ${BUYERS} buyers rush ${SEATS} seats (${RUNS} runs each)`,
    '',
    '| Implementation | Seats granted | Capacity | Worst oversell | Errors | Mean duration (ms) | Mean p95 latency (ms) |',
    '|---|---|---|---|---|---|---|',
    ...Object.entries(output.rush.results).map(([n, s]) => row(n, s, SEATS)),
    '',
    `## Experiment 2 — one user fires ${BURST} parallel requests, limit ${PER_USER_LIMIT} (${RUNS} runs each)`,
    '',
    '| Implementation | Seats granted | Limit | Worst over-limit | Errors | Mean duration (ms) | Mean p95 latency (ms) |',
    '|---|---|---|---|---|---|---|',
    ...Object.entries(output.burst.results).map(([n, s]) =>
      row(n, { ...s, oversoldMax: Math.max(0, s.grantedMax - PER_USER_LIMIT) }, PER_USER_LIMIT),
    ),
    '',
  ].join('\n'),
);

console.log(`\nWrote ${outDir}results.json and results.md`);
await disconnectDb();
await closeRedis();
await replSet.stop();
