import { afterAll, describe, expect, it } from 'vitest';
import { closeRedis } from '../lib/redis.js';
import { HoldModel } from '../models/hold.model.js';
import { TicketTierModel } from '../models/ticket-tier.model.js';
import { createAttendees, seedPublishedTier } from '../test/helpers.js';
import { reserveSeats } from './inventory.service.js';

afterAll(async () => {
  await closeRedis();
});

describe('concurrent reservations', () => {
  it('500 simultaneous buyers for 100 seats: exactly 100 succeed, the rest are told it is sold out', async () => {
    const { tierId } = await seedPublishedTier({ quantityTotal: 100 });
    const buyers = await createAttendees(500);

    const started = Date.now();
    const results = await Promise.allSettled(
      buyers.map((b) => reserveSeats(b, { tierId, quantity: 1 })),
    );
    const elapsedMs = Date.now() - started;

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const soldOut = results.filter(
      (r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'SOLD_OUT',
    ).length;
    const tier = await TicketTierModel.findById(tierId).lean();

    console.info(`500 concurrent reservations resolved in ${elapsedMs} ms`);
    expect(ok).toBe(100);
    expect(soldOut).toBe(400);
    expect(tier).toMatchObject({ quantityHeld: 100, quantitySold: 0 });
    expect(await HoldModel.countDocuments({ tierId, status: 'active' })).toBe(100);
  });

  it('one user firing 20 parallel requests cannot exceed a per-user limit of 4', async () => {
    const { tierId } = await seedPublishedTier({ quantityTotal: 100, perUserLimit: 4 });
    const [buyer] = await createAttendees(1);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => reserveSeats(buyer!, { tierId, quantity: 1 })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    expect(
      await HoldModel.countDocuments({ tierId, userId: buyer!.userId, status: 'active' }),
    ).toBe(4);
    expect((await TicketTierModel.findById(tierId).lean())?.quantityHeld).toBe(4);
  });
});
