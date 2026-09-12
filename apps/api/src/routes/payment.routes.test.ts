import { createHmac } from 'node:crypto';
import type { CheckoutSession, Hold, Order, Ticket, TicketWithQr } from '@gatherly/types';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { subscribe } from '../lib/domain-events.js';
import { MemoryTransport, setEmailTransport } from '../lib/email.js';
import { setPaymentGateway } from '../lib/payment-gateway.js';
import { closeRedis } from '../lib/redis.js';
import { parseTicketQr, signTicket } from '../lib/signatures.js';
import { EventModel } from '../models/event.model.js';
import { HoldModel } from '../models/hold.model.js';
import { OrderModel } from '../models/order.model.js';
import { PromoCodeModel } from '../models/promo-code.model.js';
import { RefundModel } from '../models/refund.model.js';
import { TicketModel } from '../models/ticket.model.js';
import { TicketTierModel } from '../models/ticket-tier.model.js';
import { expireHold } from '../services/inventory.service.js';
import { sendTicketEmail } from '../services/notification.service.js';
import { processRefund, refundCancelledEvent } from '../services/refund.service.js';
import { signAccessToken } from '../services/token.service.js';
import { FakeGateway } from '../test/fake-gateway.js';
import { app, bearer, createUser, seedPublishedTier } from '../test/helpers.js';

let gateway: FakeGateway;
let buyer: { id: string; token: string };
let seeded: { eventId: string; tierId: string; organiserId: string };
let organiserToken: string;
const refundRequests: string[] = [];
const unsubscribe = subscribe('refund.requested', ({ refundId }) => {
  refundRequests.push(refundId);
});

beforeEach(async () => {
  gateway = new FakeGateway();
  setPaymentGateway(gateway);
  refundRequests.length = 0;
  buyer = await createUser('attendee', 'Priya Buyer');
  seeded = await seedPublishedTier({ quantityTotal: 10, perUserLimit: 6, priceMinor: 50_000 });
  organiserToken = signAccessToken({ id: seeded.organiserId, role: 'organiser', tokenVersion: 0 });
});

afterEach(() => {
  setPaymentGateway(undefined);
  setEmailTransport(undefined);
});

afterAll(async () => {
  unsubscribe();
  await closeRedis();
});

async function pendingOrder(quantity = 2, promoCode?: string): Promise<Order> {
  const hold = (
    await request(app)
      .post('/api/holds')
      .set(...bearer(buyer.token))
      .send({ tierId: seeded.tierId, quantity })
      .expect(201)
  ).body as Hold;
  return (
    await request(app)
      .post('/api/orders')
      .set(...bearer(buyer.token))
      .send({ holdIds: [hold.id], ...(promoCode ? { promoCode } : {}) })
      .expect(201)
  ).body as Order;
}

async function checkout(orderId: string): Promise<CheckoutSession> {
  return (
    await request(app)
      .post(`/api/orders/${orderId}/pay`)
      .set(...bearer(buyer.token))
      .expect(200)
  ).body as CheckoutSession;
}

function checkoutSignature(razorpayOrderId: string, paymentId: string): string {
  return createHmac('sha256', env.RAZORPAY_KEY_SECRET!)
    .update(`${razorpayOrderId}|${paymentId}`)
    .digest('hex');
}

function webhook(body: object, deliveryId: string, secret = env.RAZORPAY_WEBHOOK_SECRET!) {
  const raw = JSON.stringify(body);
  return request(app)
    .post('/api/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-event-id', deliveryId)
    .set('x-razorpay-signature', createHmac('sha256', secret).update(raw).digest('hex'))
    .send(raw);
}

function capturedEvent(razorpayOrderId: string, amount: number, paymentId = 'pay_fake1') {
  return {
    event: 'payment.captured',
    payload: {
      payment: { entity: { id: paymentId, order_id: razorpayOrderId, amount, status: 'captured' } },
    },
  };
}

const tier = () => TicketTierModel.findById(seeded.tierId).lean();

describe('checkout', () => {
  it('creates one Razorpay order for the exact total and reuses it on a second click', async () => {
    const order = await pendingOrder(2);
    const first = await checkout(order.id);
    const second = await checkout(order.id);

    expect(first).toMatchObject({
      kind: 'razorpay',
      amountMinor: 100_000,
      currency: 'INR',
      keyId: 'rzp_test_dummy',
    });
    expect(first.kind === 'razorpay' && first.prefill.name).toBe('Priya Buyer');
    expect(second.kind === 'razorpay' && second.razorpayOrderId).toBe(
      first.kind === 'razorpay' && first.razorpayOrderId,
    );
    expect(gateway.ordersCreated).toEqual([
      { id: 'order_fake1', amountMinor: 100_000, receipt: order.id },
    ]);
  });

  it('confirms a fully discounted order without touching the gateway', async () => {
    await PromoCodeModel.create({
      eventId: seeded.eventId,
      code: 'COMP',
      type: 'percent',
      value: 100,
    });
    const order = await pendingOrder(2, 'COMP');
    const session = await checkout(order.id);

    expect(session).toEqual({ kind: 'free', orderId: order.id, status: 'paid' });
    expect(gateway.ordersCreated).toHaveLength(0);
    expect(await TicketModel.countDocuments({ orderId: order.id })).toBe(2);
    expect(await tier()).toMatchObject({ quantityHeld: 0, quantitySold: 2 });
  });
});

describe('checkout callback verification', () => {
  it('marks the order paid, converts holds to sold and mints one signed ticket per seat', async () => {
    const order = await pendingOrder(3);
    const session = await checkout(order.id);
    if (session.kind !== 'razorpay') throw new Error('expected razorpay');

    const res = await request(app)
      .post(`/api/orders/${order.id}/verify`)
      .set(...bearer(buyer.token))
      .send({
        razorpay_order_id: session.razorpayOrderId,
        razorpay_payment_id: 'pay_abc',
        razorpay_signature: checkoutSignature(session.razorpayOrderId, 'pay_abc'),
      })
      .expect(200);

    expect((res.body as Order).status).toBe('paid');
    expect(await tier()).toMatchObject({ quantityHeld: 0, quantitySold: 3 });
    expect(await HoldModel.countDocuments({ orderId: order.id, status: 'converted' })).toBe(1);
    const tickets = await TicketModel.find({ orderId: order.id }).lean();
    expect(tickets).toHaveLength(3);
    expect(new Set(tickets.map((t) => t.serial)).size).toBe(3);
    tickets.forEach((t) =>
      expect(t.serial).toMatch(/^GTH-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/),
    );
  });

  it('rejects a forged signature and leaves the order unpaid', async () => {
    const order = await pendingOrder(1);
    const session = await checkout(order.id);
    if (session.kind !== 'razorpay') throw new Error('expected razorpay');

    await request(app)
      .post(`/api/orders/${order.id}/verify`)
      .set(...bearer(buyer.token))
      .send({
        razorpay_order_id: session.razorpayOrderId,
        razorpay_payment_id: 'pay_forged',
        razorpay_signature: 'f'.repeat(64),
      })
      .expect(400);
    expect((await OrderModel.findById(order.id).lean())?.status).toBe('pending');
    expect(await TicketModel.countDocuments({ orderId: order.id })).toBe(0);
  });
});

describe('Razorpay webhook', () => {
  it('rejects a delivery whose signature does not match', async () => {
    const order = await pendingOrder(1);
    await checkout(order.id);
    const res = await webhook(capturedEvent('order_fake1', 50_000), 'evt_bad', 'wrong-secret');
    expect(res.status).toBe(400);
    expect((await OrderModel.findById(order.id).lean())?.status).toBe('pending');
  });

  it('confirms payment even if the browser never reports back', async () => {
    const order = await pendingOrder(2);
    await checkout(order.id);
    await webhook(capturedEvent('order_fake1', 100_000), 'evt_1').expect(200);

    expect((await OrderModel.findById(order.id).lean())?.status).toBe('paid');
    expect(await TicketModel.countDocuments({ orderId: order.id })).toBe(2);
  });

  it('the same delivery replayed three times produces exactly one set of tickets', async () => {
    const order = await pendingOrder(2);
    await checkout(order.id);
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push(
        (
          (await webhook(capturedEvent('order_fake1', 100_000), 'evt_same').expect(200)).body as {
            status: string;
          }
        ).status,
      );
    }
    expect(statuses).toEqual(['processed', 'duplicate', 'duplicate']);
    expect(await TicketModel.countDocuments({ orderId: order.id })).toBe(2);
    expect(await tier()).toMatchObject({ quantitySold: 2, quantityHeld: 0 });
  });

  it('concurrent duplicate deliveries still produce one set of tickets', async () => {
    const order = await pendingOrder(2);
    await checkout(order.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => webhook(capturedEvent('order_fake1', 100_000), 'evt_burst')),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await TicketModel.countDocuments({ orderId: order.id })).toBe(2);
  });

  it('webhook, a second event type and the browser callback together still deliver one set', async () => {
    const order = await pendingOrder(2);
    const session = await checkout(order.id);
    if (session.kind !== 'razorpay') throw new Error('expected razorpay');

    await Promise.all([
      webhook(capturedEvent(session.razorpayOrderId, 100_000, 'pay_x'), 'evt_a'),
      webhook(
        { ...capturedEvent(session.razorpayOrderId, 100_000, 'pay_x'), event: 'order.paid' },
        'evt_b',
      ),
      request(app)
        .post(`/api/orders/${order.id}/verify`)
        .set(...bearer(buyer.token))
        .send({
          razorpay_order_id: session.razorpayOrderId,
          razorpay_payment_id: 'pay_x',
          razorpay_signature: checkoutSignature(session.razorpayOrderId, 'pay_x'),
        }),
    ]);
    expect(await TicketModel.countDocuments({ orderId: order.id })).toBe(2);
    expect(await tier()).toMatchObject({ quantitySold: 2, quantityHeld: 0 });
  });

  it('refunds instead of fulfilling when the amount paid does not match the order', async () => {
    const order = await pendingOrder(2);
    await checkout(order.id);
    await webhook(capturedEvent('order_fake1', 100), 'evt_tampered').expect(200);

    const saved = await OrderModel.findById(order.id).lean();
    expect(saved).toMatchObject({ status: 'failed', razorpayPaymentId: 'pay_fake1' });
    expect(await TicketModel.countDocuments({ orderId: order.id })).toBe(0);
    expect(await RefundModel.countDocuments({ orderId: order.id })).toBe(1);
    expect(refundRequests).toHaveLength(1);
  });

  it('honours a late payment when the lapsed seats are still free', async () => {
    const order = await pendingOrder(2);
    await checkout(order.id);
    const hold = await HoldModel.findOne({ orderId: order.id }).lean();
    await expireHold(hold!._id.toString(), new Date(Date.now() + 3_600_000));
    expect((await OrderModel.findById(order.id).lean())?.status).toBe('expired');

    await webhook(capturedEvent('order_fake1', 100_000), 'evt_late').expect(200);
    expect((await OrderModel.findById(order.id).lean())?.status).toBe('paid');
    expect(await tier()).toMatchObject({ quantitySold: 2, quantityHeld: 0 });
  });

  it('refunds a late payment when the lapsed seats were sold to someone else', async () => {
    const order = await pendingOrder(2);
    await checkout(order.id);
    const hold = await HoldModel.findOne({ orderId: order.id }).lean();
    await expireHold(hold!._id.toString(), new Date(Date.now() + 3_600_000));
    await TicketTierModel.updateOne({ _id: seeded.tierId }, { quantitySold: 10 });

    await webhook(capturedEvent('order_fake1', 100_000), 'evt_too_late').expect(200);
    expect((await OrderModel.findById(order.id).lean())?.status).toBe('failed');
    expect((await tier())?.quantitySold).toBe(10);
    expect(await RefundModel.countDocuments({ orderId: order.id })).toBe(1);
  });

  it('acknowledges events it does not act on', async () => {
    const res = await webhook({ event: 'payment.authorized', payload: {} }, 'evt_other').expect(
      200,
    );
    expect(res.body).toEqual({ status: 'ignored' });
  });
});

async function paidOrder(quantity = 2): Promise<Order> {
  const order = await pendingOrder(quantity);
  await checkout(order.id);
  await webhook(
    capturedEvent('order_fake1', quantity * 50_000, 'pay_paid'),
    `evt_paid_${order.id}`,
  ).expect(200);
  return order;
}

describe('refunds', () => {
  it('organiser refunds an order: tickets void at once, seats return when the gateway accepts', async () => {
    const order = await paidOrder(2);
    const path = `/api/organiser/events/${seeded.eventId}/orders/${order.id}/refund`;

    await request(app)
      .post(path)
      .set(...bearer(organiserToken))
      .send({ reason: 'Buyer requested' })
      .expect(202);
    expect(await TicketModel.countDocuments({ orderId: order.id, status: 'refunded' })).toBe(2);
    await request(app)
      .post(path)
      .set(...bearer(organiserToken))
      .send({ reason: 'Again' })
      .expect(409);

    expect(await processRefund(refundRequests[0]!)).toBe('processed');
    expect(gateway.refundsIssued).toMatchObject([{ paymentId: 'pay_paid', amountMinor: 100_000 }]);
    expect((await OrderModel.findById(order.id).lean())?.status).toBe('refunded');
    expect((await tier())?.quantitySold).toBe(0);
  });

  it("another organiser cannot refund this event's orders", async () => {
    const order = await paidOrder(1);
    const intruder = await createUser('organiser');
    await request(app)
      .post(`/api/organiser/events/${seeded.eventId}/orders/${order.id}/refund`)
      .set(...bearer(intruder.token))
      .send({ reason: 'Not mine' })
      .expect(404);
  });

  it('a retried refund job never refunds twice, even if the first attempt crashed after reaching Razorpay', async () => {
    const order = await paidOrder(1);
    await request(app)
      .post(`/api/organiser/events/${seeded.eventId}/orders/${order.id}/refund`)
      .set(...bearer(organiserToken))
      .send({ reason: 'Duplicate purchase' })
      .expect(202);
    const refundId = refundRequests[0]!;

    // Simulate a crash after the gateway call: the refund exists at Razorpay but our row is still pending.
    await gateway.refund({
      paymentId: 'pay_paid',
      amountMinor: 50_000,
      notes: { refundId, orderId: order.id },
    });

    await processRefund(refundId);
    await processRefund(refundId);
    expect(gateway.refundsIssued).toHaveLength(1);
    expect((await RefundModel.findById(refundId).lean())?.status).toBe('processed');
  });

  it('records the error and rethrows so the job retries when the gateway fails', async () => {
    const order = await paidOrder(1);
    await request(app)
      .post(`/api/organiser/events/${seeded.eventId}/orders/${order.id}/refund`)
      .set(...bearer(organiserToken))
      .send({ reason: 'Retry me' })
      .expect(202);
    gateway.failNextRefund = true;

    await expect(processRefund(refundRequests[0]!)).rejects.toThrow('Gateway timeout');
    expect((await RefundModel.findById(refundRequests[0]).lean())?.lastError).toContain(
      'Gateway timeout',
    );
    expect(await processRefund(refundRequests[0]!)).toBe('processed');
  });

  it('cancelling an event refunds every paid order without restocking', async () => {
    await paidOrder(2);
    await EventModel.updateOne({ _id: seeded.eventId }, { status: 'cancelled' });
    expect(await refundCancelledEvent(seeded.eventId)).toBe(1);
    expect(await refundCancelledEvent(seeded.eventId)).toBe(0);

    await processRefund(refundRequests[0]!);
    expect(gateway.refundsIssued).toHaveLength(1);
    expect((await tier())?.quantitySold).toBe(2);
  });

  it('lists event orders for the organiser with buyer and refund state', async () => {
    const order = await paidOrder(2);
    const res = await request(app)
      .get(`/api/organiser/events/${seeded.eventId}/orders`)
      .set(...bearer(organiserToken))
      .expect(200);
    expect((res.body as { items: unknown[] }).items).toMatchObject([
      {
        id: order.id,
        status: 'paid',
        seats: 2,
        totalMinor: 100_000,
        buyer: { name: 'Priya Buyer' },
        refund: null,
      },
    ]);
  });
});

describe('tickets', () => {
  it('lists the buyer’s tickets and serves a signed QR that verifies', async () => {
    await paidOrder(2);
    const list = (
      await request(app)
        .get('/api/tickets')
        .set(...bearer(buyer.token))
        .expect(200)
    ).body as {
      items: Ticket[];
    };
    expect(list.items).toHaveLength(2);
    expect(list.items[0]).toMatchObject({
      status: 'valid',
      eventTitle: 'Load Test Live',
      tierName: 'General',
    });

    const ticket = (
      await request(app)
        .get(`/api/tickets/${list.items[0]!.id}`)
        .set(...bearer(buyer.token))
        .expect(200)
    ).body as TicketWithQr;
    expect(ticket.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const parsed = parseTicketQr(ticket.qrPayload)!;
    expect(parsed).toMatchObject({ ticketId: ticket.id, serial: ticket.serial });
    expect(parsed.signature).toBe(
      signTicket(env.TICKET_SIGNING_SECRET, ticket.id, ticket.serial, ticket.eventId),
    );
  });

  it("hides another user's ticket", async () => {
    await paidOrder(1);
    const [t] = await TicketModel.find({ userId: buyer.id }).lean();
    const other = await createUser('attendee');
    await request(app)
      .get(`/api/tickets/${t!._id.toString()}`)
      .set(...bearer(other.token))
      .expect(404);
  });

  it('downloads a ticket as a PDF', async () => {
    await paidOrder(1);
    const [t] = await TicketModel.find({ userId: buyer.id }).lean();
    const res = await request(app)
      .get(`/api/tickets/${t!._id.toString()}/pdf`)
      .set(...bearer(buyer.token))
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('emails the tickets once, with the PDF attached', async () => {
    const transport = new MemoryTransport();
    setEmailTransport(transport);
    const order = await paidOrder(2);

    expect(await sendTicketEmail(order.id)).toBe('sent');
    expect(await sendTicketEmail(order.id)).toBe('skipped');
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({ subject: 'Your 2 tickets for Load Test Live' });
    expect(transport.sent[0]!.attachments![0]!.content.subarray(0, 4).toString()).toBe('%PDF');
  });
});
