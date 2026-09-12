import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { publish } from '../lib/domain-events.js';
import { closeRedis } from '../lib/redis.js';
import { HoldModel } from '../models/hold.model.js';
import { TicketTierModel } from '../models/ticket-tier.model.js';
import { reserveSeats } from '../services/inventory.service.js';
import { createAttendees, seedPublishedTier } from '../test/helpers.js';
import { QUEUE_NAMES, createQueueRegistry, holdExpiryJobId, scheduleHoldExpiry } from './queues.js';
import { startWorkers, wireProducers } from './workers.js';

// A unique prefix isolates this run's Redis keys from dev data and parallel runs.
const registry = createQueueRegistry(`test-${randomUUID().slice(0, 8)}`);

afterAll(async () => {
  const queues = Object.values(QUEUE_NAMES).map((n) => registry.get(n));
  await Promise.all(queues.map((q) => q.obliterate({ force: true })));
  await registry.close();
  await closeRedis();
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('condition not met in time');
}

describe('background hold expiry', () => {
  it('a delayed job expires the hold at its deadline and returns the seats', async () => {
    const unsubscribe = wireProducers(registry);
    const workers = await startWorkers(registry);
    try {
      const { tierId } = await seedPublishedTier({ quantityTotal: 5 });
      const [buyer] = await createAttendees(1);
      const hold = await reserveSeats(buyer!, { tierId, quantity: 2 });

      // Pull the deadline in to one second from now and re-announce it.
      const soon = new Date(Date.now() + 1_000);
      await HoldModel.updateOne({ _id: hold.id }, { expiresAt: soon });
      await registry.get(QUEUE_NAMES.holdExpiry).remove(holdExpiryJobId(hold.id));
      await publish('hold.created', {
        holdId: hold.id,
        expiresAt: soon,
        eventId: hold.eventId,
        tierId,
      });

      await waitFor(async () => (await HoldModel.findById(hold.id).lean())?.status === 'expired');
      expect((await TicketTierModel.findById(tierId).lean())?.quantityHeld).toBe(0);
    } finally {
      unsubscribe();
      await workers.close();
    }
  });

  it('scheduling the same hold twice creates one job', async () => {
    const holdId = randomUUID().replace(/-/g, '').slice(0, 24);
    const at = new Date(Date.now() + 60 * 60 * 1000);
    await scheduleHoldExpiry(registry, holdId, at);
    await scheduleHoldExpiry(registry, holdId, at);
    const delayed = await registry.get(QUEUE_NAMES.holdExpiry).getDelayed();
    expect(delayed.filter((j) => j.id === holdExpiryJobId(holdId))).toHaveLength(1);
  });
});
