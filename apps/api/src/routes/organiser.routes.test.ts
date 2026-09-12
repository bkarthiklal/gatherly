import type {
  AuditLog,
  CheckInResponse,
  EventAnalytics,
  OrganiserOverview,
  Paginated,
} from '@gatherly/types';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { closeRedis } from '../lib/redis.js';
import { ticketQrPayload } from '../lib/signatures.js';
import { PromoCodeModel } from '../models/promo-code.model.js';
import { TicketModel } from '../models/ticket.model.js';
import { signAccessToken } from '../services/token.service.js';
import { app, bearer, buyTickets, createUser, seedPublishedTier } from '../test/helpers.js';

afterAll(async () => {
  await closeRedis();
});

let seeded: { eventId: string; tierId: string; organiserId: string };
let organiserToken: string;
let buyer: { id: string; token: string };

beforeEach(async () => {
  seeded = await seedPublishedTier({ quantityTotal: 50, perUserLimit: 10, priceMinor: 40_000 });
  organiserToken = signAccessToken({ id: seeded.organiserId, role: 'organiser', tokenVersion: 0 });
  buyer = await createUser('attendee', 'Arjun Attendee');
});

async function qrFor(ticketId: string): Promise<string> {
  const t = await TicketModel.findById(ticketId).lean();
  return ticketQrPayload(env.TICKET_SIGNING_SECRET, ticketId, t!.serial, t!.eventId.toString());
}

function scan(body: object, token = organiserToken, eventId = seeded.eventId) {
  return request(app)
    .post(`/api/organiser/events/${eventId}/check-in`)
    .set(...bearer(token))
    .send(body);
}

describe('check-in', () => {
  it('admits a valid ticket once, then reports when it was already used', async () => {
    const { ticketIds } = await buyTickets(buyer.id, seeded.tierId, 2);
    const qrPayload = await qrFor(ticketIds[0]!);

    const first = (await scan({ qrPayload }).expect(200)).body as CheckInResponse;
    expect(first).toMatchObject({
      result: 'admitted',
      ticket: { attendeeName: 'Arjun Attendee', tierName: 'General' },
      stats: { checkedIn: 1, total: 2 },
    });

    const second = (await scan({ qrPayload }).expect(200)).body as CheckInResponse;
    expect(second.result).toBe('already-used');
    expect(second.ticket?.checkedInAt).toBe(first.ticket?.checkedInAt);
  });

  it('two stewards scanning the same ticket at the same instant: exactly one admits', async () => {
    const { ticketIds } = await buyTickets(buyer.id, seeded.tierId, 1);
    const qrPayload = await qrFor(ticketIds[0]!);

    const results = await Promise.all(Array.from({ length: 10 }, () => scan({ qrPayload })));
    const outcomes = results.map((r) => (r.body as CheckInResponse).result);
    expect(outcomes.filter((o) => o === 'admitted')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'already-used')).toHaveLength(9);
  });

  it('rejects a QR whose signature was tampered with', async () => {
    const { ticketIds } = await buyTickets(buyer.id, seeded.tierId, 1);
    const genuine = await qrFor(ticketIds[0]!);
    const forged = `${genuine.slice(0, -4)}AAAA`;
    const res = (await scan({ qrPayload: forged }).expect(200)).body as CheckInResponse;
    expect(res.result).toBe('invalid');
    expect((await TicketModel.findById(ticketIds[0]).lean())?.status).toBe('valid');
  });

  it('refuses a genuine ticket for a different event', async () => {
    const other = await seedPublishedTier({ quantityTotal: 5 });
    const { ticketIds } = await buyTickets(buyer.id, other.tierId, 1);
    const res = (await scan({ qrPayload: await qrFor(ticketIds[0]!) }).expect(200))
      .body as CheckInResponse;
    expect(res.result).toBe('wrong-event');
  });

  it('rejects garbage that is not a Gatherly QR', async () => {
    const res = (await scan({ qrPayload: 'https://example.com/not-a-ticket' }).expect(200))
      .body as CheckInResponse;
    expect(res.result).toBe('invalid');
  });

  it('admits by typed serial, case-insensitively', async () => {
    const { ticketIds } = await buyTickets(buyer.id, seeded.tierId, 1);
    const t = await TicketModel.findById(ticketIds[0]).lean();
    const res = (await scan({ serial: t!.serial.toLowerCase() }).expect(200))
      .body as CheckInResponse;
    expect(res.result).toBe('admitted');
  });

  it('refuses a refunded ticket', async () => {
    const { ticketIds } = await buyTickets(buyer.id, seeded.tierId, 1);
    await TicketModel.updateOne({ _id: ticketIds[0]! }, { status: 'refunded' });
    const res = (await scan({ qrPayload: await qrFor(ticketIds[0]!) }).expect(200))
      .body as CheckInResponse;
    expect(res.result).toBe('refunded');
  });

  it("only the event's organiser can scan", async () => {
    const { ticketIds } = await buyTickets(buyer.id, seeded.tierId, 1);
    const qrPayload = await qrFor(ticketIds[0]!);
    const intruder = await createUser('organiser');
    await scan({ qrPayload }, intruder.token).expect(404);
    await scan({ qrPayload }, buyer.token).expect(403);
  });

  it('records every scan in the audit log, visible only to admins', async () => {
    const { ticketIds } = await buyTickets(buyer.id, seeded.tierId, 1);
    const qrPayload = await qrFor(ticketIds[0]!);
    await scan({ qrPayload });
    await scan({ qrPayload });

    const admin = await createUser('admin');
    const logs = (
      await request(app)
        .get('/api/admin/audit-logs')
        .set(...bearer(admin.token))
        .expect(200)
    ).body as Paginated<AuditLog>;
    expect(logs.items.map((l) => l.action)).toEqual([
      'ticket.check-in.already-used',
      'ticket.check-in.admitted',
    ]);
    expect(logs.items[0]!.actor?.id).toBe(seeded.organiserId);
    await request(app)
      .get('/api/admin/audit-logs')
      .set(...bearer(organiserToken))
      .expect(403);
  });
});

describe('analytics', () => {
  it('reports revenue, per-tier sales, daily sales, promo use and check-ins', async () => {
    await PromoCodeModel.create({
      eventId: seeded.eventId,
      code: 'HALF',
      type: 'percent',
      value: 50,
    });
    await buyTickets(buyer.id, seeded.tierId, 3);
    const second = await createUser('attendee');
    const { ticketIds } = await buyTickets(second.id, seeded.tierId, 2, 'HALF');
    await scan({ qrPayload: await qrFor(ticketIds[0]!) });

    const res = (
      await request(app)
        .get(`/api/organiser/events/${seeded.eventId}/analytics`)
        .set(...bearer(organiserToken))
        .expect(200)
    ).body as EventAnalytics;

    expect(res).toMatchObject({
      revenueMinor: 3 * 40_000 + 40_000,
      ordersPaid: 2,
      ticketsSold: 5,
      capacity: 50,
      checkedIn: 1,
      tiers: [{ name: 'General', sold: 5, capacity: 50, revenueMinor: 5 * 40_000 }],
      promoCodes: [{ code: 'HALF', uses: 1, discountMinor: 40_000 }],
    });
    expect(res.salesByDay).toHaveLength(1);
    expect(res.salesByDay[0]).toMatchObject({ tickets: 5, revenueMinor: 160_000 });
  });

  it('summarises all of an organiser’s events', async () => {
    await buyTickets(buyer.id, seeded.tierId, 4);
    const res = (
      await request(app)
        .get('/api/organiser/overview')
        .set(...bearer(organiserToken))
        .expect(200)
    ).body as OrganiserOverview;
    expect(res).toMatchObject({ events: 1, published: 1, ticketsSold: 4, revenueMinor: 160_000 });
    expect(res.upcoming).toMatchObject([{ id: seeded.eventId, sold: 4, capacity: 50 }]);
  });
});
