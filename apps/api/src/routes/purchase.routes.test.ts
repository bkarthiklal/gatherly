import type { Hold, Order, OrderQuote, PromoCode } from '@gatherly/types';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeRedis } from '../lib/redis.js';
import { HoldModel } from '../models/hold.model.js';
import { PromoCodeModel } from '../models/promo-code.model.js';
import { TicketTierModel } from '../models/ticket-tier.model.js';
import {
  expireHold,
  reconcileHeldCounts,
  sweepExpiredHolds,
} from '../services/inventory.service.js';
import { app, bearer, createUser, seedPublishedTier } from '../test/helpers.js';

afterAll(async () => {
  await closeRedis();
});

let buyer: { id: string; token: string };
let otherBuyer: { id: string; token: string };
let seeded: { eventId: string; tierId: string; organiserId: string };

beforeEach(async () => {
  [buyer, otherBuyer] = await Promise.all([createUser('attendee'), createUser('attendee')]);
  seeded = await seedPublishedTier({ quantityTotal: 10, perUserLimit: 4, priceMinor: 50_000 });
});

async function hold(token: string, quantity = 2, tierId = seeded.tierId): Promise<Hold> {
  const res = await request(app)
    .post('/api/holds')
    .set(...bearer(token))
    .send({ tierId, quantity })
    .expect(201);
  return res.body as Hold;
}

async function tier() {
  return TicketTierModel.findById(seeded.tierId).lean();
}

describe('holds', () => {
  it('reserves seats, captures the price, and moves them from available to held', async () => {
    const h = await hold(buyer.token, 3);
    expect(h).toMatchObject({
      quantity: 3,
      unitPriceMinor: 50_000,
      status: 'active',
      orderId: null,
    });
    expect(new Date(h.expiresAt).getTime()).toBeGreaterThan(Date.now() + 7 * 60 * 1000);
    expect(await tier()).toMatchObject({ quantityHeld: 3, quantitySold: 0 });
  });

  it('enforces the per-user limit across separate reservations', async () => {
    await hold(buyer.token, 3);
    const res = await request(app)
      .post('/api/holds')
      .set(...bearer(buyer.token))
      .send({ tierId: seeded.tierId, quantity: 2 })
      .expect(409);
    expect(res.body).toMatchObject({ error: { code: 'PURCHASE_LIMIT_REACHED' } });
  });

  it('reports sold out when too few seats remain', async () => {
    await TicketTierModel.updateOne({ _id: seeded.tierId }, { quantitySold: 9 });
    const res = await request(app)
      .post('/api/holds')
      .set(...bearer(buyer.token))
      .send({ tierId: seeded.tierId, quantity: 2 })
      .expect(409);
    expect(res.body).toMatchObject({ error: { code: 'SOLD_OUT' } });
  });

  it('releases a hold and returns the seats', async () => {
    const h = await hold(buyer.token, 2);
    await request(app)
      .delete(`/api/holds/${h.id}`)
      .set(...bearer(buyer.token))
      .expect(204);
    expect((await tier())?.quantityHeld).toBe(0);
    await request(app)
      .delete(`/api/holds/${h.id}`)
      .set(...bearer(buyer.token))
      .expect(409);
  });

  it("does not let one user release another user's hold", async () => {
    const h = await hold(buyer.token, 1);
    await request(app)
      .delete(`/api/holds/${h.id}`)
      .set(...bearer(otherBuyer.token))
      .expect(404);
  });

  it('refuses to reserve on an event that is not published', async () => {
    const { EventModel } = await import('../models/event.model.js');
    await EventModel.updateOne({ _id: seeded.eventId }, { status: 'draft' });
    await request(app)
      .post('/api/holds')
      .set(...bearer(buyer.token))
      .send({ tierId: seeded.tierId, quantity: 1 })
      .expect(404);
  });
});

describe('orders', () => {
  it('creates a pending order from holds without selling the seats yet', async () => {
    const h = await hold(buyer.token, 2);
    const res = await request(app)
      .post('/api/orders')
      .set(...bearer(buyer.token))
      .send({ holdIds: [h.id] })
      .expect(201);
    const order = res.body as Order;
    expect(order).toMatchObject({
      status: 'pending',
      subtotalMinor: 100_000,
      discountMinor: 0,
      totalMinor: 100_000,
      eventTitle: 'Load Test Live',
    });
    expect(await tier()).toMatchObject({ quantityHeld: 2, quantitySold: 0 });
    expect((await HoldModel.findById(h.id).lean())?.orderId?.toString()).toBe(order.id);
  });

  it('will not put the same hold into two orders', async () => {
    const h = await hold(buyer.token, 1);
    await request(app)
      .post('/api/orders')
      .set(...bearer(buyer.token))
      .send({ holdIds: [h.id] })
      .expect(201);
    await request(app)
      .post('/api/orders')
      .set(...bearer(buyer.token))
      .send({ holdIds: [h.id] })
      .expect(409);
  });

  it("will not build an order from someone else's hold", async () => {
    const h = await hold(buyer.token, 1);
    await request(app)
      .post('/api/orders')
      .set(...bearer(otherBuyer.token))
      .send({ holdIds: [h.id] })
      .expect(404);
  });

  it('hides orders from other users', async () => {
    const h = await hold(buyer.token, 1);
    const order = (
      await request(app)
        .post('/api/orders')
        .set(...bearer(buyer.token))
        .send({ holdIds: [h.id] })
        .expect(201)
    ).body as Order;
    await request(app)
      .get(`/api/orders/${order.id}`)
      .set(...bearer(otherBuyer.token))
      .expect(404);
    await request(app)
      .get(`/api/orders/${order.id}`)
      .set(...bearer(buyer.token))
      .expect(200);
  });

  it('cancelling an unpaid order returns seats and promo use', async () => {
    await PromoCodeModel.create({
      eventId: seeded.eventId,
      code: 'TENOFF',
      type: 'percent',
      value: 10,
      maxUses: 5,
    });
    const h = await hold(buyer.token, 2);
    const order = (
      await request(app)
        .post('/api/orders')
        .set(...bearer(buyer.token))
        .send({ holdIds: [h.id], promoCode: 'tenoff' })
        .expect(201)
    ).body as Order;
    expect(order).toMatchObject({ discountMinor: 10_000, totalMinor: 90_000, promoCode: 'TENOFF' });
    expect((await PromoCodeModel.findOne({ code: 'TENOFF' }).lean())?.usedCount).toBe(1);

    await request(app)
      .post(`/api/orders/${order.id}/cancel`)
      .set(...bearer(buyer.token))
      .expect(200);
    expect((await tier())?.quantityHeld).toBe(0);
    expect((await PromoCodeModel.findOne({ code: 'TENOFF' }).lean())?.usedCount).toBe(0);
    await request(app)
      .post(`/api/orders/${order.id}/cancel`)
      .set(...bearer(buyer.token))
      .expect(409);
  });
});

describe('promo codes', () => {
  it('quotes a discount without consuming the code', async () => {
    await PromoCodeModel.create({
      eventId: seeded.eventId,
      code: 'FLAT200',
      type: 'fixed',
      value: 20_000,
      maxUses: 1,
    });
    const h = await hold(buyer.token, 1);
    const quote = (
      await request(app)
        .post('/api/orders/quote')
        .set(...bearer(buyer.token))
        .send({ holdIds: [h.id], promoCode: 'FLAT200' })
        .expect(200)
    ).body as OrderQuote;
    expect(quote).toMatchObject({
      subtotalMinor: 50_000,
      discountMinor: 20_000,
      totalMinor: 30_000,
    });
    expect((await PromoCodeModel.findOne({ code: 'FLAT200' }).lean())?.usedCount).toBe(0);
  });

  it('never discounts below zero', async () => {
    await PromoCodeModel.create({
      eventId: seeded.eventId,
      code: 'HUGE',
      type: 'fixed',
      value: 9_999_999,
    });
    const h = await hold(buyer.token, 1);
    const quote = (
      await request(app)
        .post('/api/orders/quote')
        .set(...bearer(buyer.token))
        .send({ holdIds: [h.id], promoCode: 'HUGE' })
        .expect(200)
    ).body as OrderQuote;
    expect(quote.totalMinor).toBe(0);
  });

  it('gives the last use of a code to exactly one of two racing buyers', async () => {
    await PromoCodeModel.create({
      eventId: seeded.eventId,
      code: 'LASTONE',
      type: 'percent',
      value: 50,
      maxUses: 1,
    });
    const [a, b] = await Promise.all([hold(buyer.token, 1), hold(otherBuyer.token, 1)]);

    const results = await Promise.all([
      request(app)
        .post('/api/orders')
        .set(...bearer(buyer.token))
        .send({ holdIds: [a.id], promoCode: 'LASTONE' }),
      request(app)
        .post('/api/orders')
        .set(...bearer(otherBuyer.token))
        .send({ holdIds: [b.id], promoCode: 'LASTONE' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect((await PromoCodeModel.findOne({ code: 'LASTONE' }).lean())?.usedCount).toBe(1);
  });

  it('rejects unknown, inactive and expired codes with 422', async () => {
    await PromoCodeModel.create([
      { eventId: seeded.eventId, code: 'OFF', type: 'percent', value: 10, active: false },
      {
        eventId: seeded.eventId,
        code: 'OLD',
        type: 'percent',
        value: 10,
        validTo: new Date(Date.now() - 1000),
      },
    ]);
    const h = await hold(buyer.token, 1);
    for (const code of ['NOPE', 'OFF', 'OLD']) {
      await request(app)
        .post('/api/orders/quote')
        .set(...bearer(buyer.token))
        .send({ holdIds: [h.id], promoCode: code })
        .expect(422);
    }
  });

  it('lets only the owning organiser manage codes', async () => {
    const owner = { id: seeded.organiserId, token: '' };
    const { signAccessToken } = await import('../services/token.service.js');
    owner.token = signAccessToken({ id: owner.id, role: 'organiser', tokenVersion: 0 });
    const intruder = await createUser('organiser');
    const path = `/api/organiser/events/${seeded.eventId}/promo-codes`;

    const created = await request(app)
      .post(path)
      .set(...bearer(owner.token))
      .send({ code: 'early-bird', type: 'percent', value: 15, maxUses: 100 })
      .expect(201);
    expect((created.body as PromoCode).code).toBe('EARLY-BIRD');

    await request(app)
      .get(path)
      .set(...bearer(intruder.token))
      .expect(404);
    await request(app)
      .get(path)
      .set(...bearer(buyer.token))
      .expect(403);
    await request(app)
      .post(path)
      .set(...bearer(owner.token))
      .send({ code: 'EARLY-BIRD', type: 'percent', value: 5 })
      .expect(409);
    const toggled = await request(app)
      .patch(`${path}/${(created.body as PromoCode).id}`)
      .set(...bearer(owner.token))
      .send({ active: false })
      .expect(200);
    expect((toggled.body as PromoCode).active).toBe(false);
  });
});

describe('expiry', () => {
  it('expires an overdue hold and the order it belongs to, releasing seats and promo use', async () => {
    await PromoCodeModel.create({
      eventId: seeded.eventId,
      code: 'EXP',
      type: 'percent',
      value: 10,
    });
    const h = await hold(buyer.token, 2);
    const order = (
      await request(app)
        .post('/api/orders')
        .set(...bearer(buyer.token))
        .send({ holdIds: [h.id], promoCode: 'EXP' })
        .expect(201)
    ).body as Order;

    const later = new Date(Date.now() + 60 * 60 * 1000);
    expect(await expireHold(h.id, later)).toBe(true);
    expect(await expireHold(h.id, later)).toBe(false); // idempotent

    const refreshed = (
      await request(app)
        .get(`/api/orders/${order.id}`)
        .set(...bearer(buyer.token))
    ).body as Order;
    expect(refreshed.status).toBe('expired');
    expect((await tier())?.quantityHeld).toBe(0);
    expect((await PromoCodeModel.findOne({ code: 'EXP' }).lean())?.usedCount).toBe(0);
  });

  it('does not expire a hold that still has time left', async () => {
    const h = await hold(buyer.token, 1);
    expect(await expireHold(h.id)).toBe(false);
    expect((await tier())?.quantityHeld).toBe(1);
  });

  it('sweeper catches every overdue hold', async () => {
    await hold(buyer.token, 1);
    await hold(otherBuyer.token, 2);
    expect(await sweepExpiredHolds(new Date(Date.now() + 60 * 60 * 1000))).toBe(2);
    expect((await tier())?.quantityHeld).toBe(0);
  });

  it('reconciliation repairs a drifted held counter', async () => {
    await hold(buyer.token, 2);
    await TicketTierModel.updateOne({ _id: seeded.tierId }, { quantityHeld: 7 });
    expect(await reconcileHeldCounts()).toBe(1);
    expect((await tier())?.quantityHeld).toBe(2);
    expect(await reconcileHeldCounts()).toBe(0);
  });
});
