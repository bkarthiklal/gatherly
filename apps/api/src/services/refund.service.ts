import type { OrganiserOrder } from '@gatherly/types';
import type { ClientSession } from 'mongoose';
import { withTransaction } from '../lib/db.js';
import { publish } from '../lib/domain-events.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getPaymentGateway } from '../lib/payment-gateway.js';
import { assertCanManage, type AuthContext } from '../middleware/auth.js';
import { EventModel } from '../models/event.model.js';
import { OrderModel, type Order } from '../models/order.model.js';
import { RefundModel, type Refund } from '../models/refund.model.js';
import { TicketModel } from '../models/ticket.model.js';
import { TicketTierModel } from '../models/ticket-tier.model.js';
import { UserModel } from '../models/user.model.js';

/**
 * Records a refund for an order, or returns the one that already exists.
 * Tickets are voided immediately — a refunded buyer must not get in while
 * the money is still on its way back — but seats go back on sale only once
 * the gateway has accepted the refund.
 */
export async function createRefundInSession(
  order: Pick<Order, '_id' | 'eventId' | 'totalMinor' | 'razorpayPaymentId'>,
  reason: string,
  restock: boolean,
  session: ClientSession,
): Promise<{ refund: Refund; created: boolean }> {
  const existing = await RefundModel.findOne({ orderId: order._id }).session(session).lean();
  if (existing) return { refund: existing, created: false };

  const [refund] = await RefundModel.create(
    [
      {
        orderId: order._id,
        eventId: order.eventId,
        paymentId: order.razorpayPaymentId,
        amountMinor: order.totalMinor,
        reason,
        restock,
      },
    ],
    { session },
  );
  await TicketModel.updateMany(
    { orderId: order._id, status: 'valid' },
    { $set: { status: 'refunded' } },
    { session },
  );
  return { refund: refund!.toObject(), created: true };
}

/** Organiser or admin refunds one paid order. */
export async function refundOrder(
  auth: AuthContext,
  eventId: string,
  orderId: string,
  reason: string,
): Promise<void> {
  const event = await EventModel.findById(eventId).select('organiserId').lean();
  assertCanManage(event?.organiserId, auth);

  const { refund, created } = await withTransaction(async (session) => {
    const order = await OrderModel.findOne({ _id: orderId, eventId }).session(session).lean();
    if (!order) throw AppError.notFound('Order not found');
    if (order.status !== 'paid') throw AppError.conflict('Only a paid order can be refunded');
    return createRefundInSession(order, reason, true, session);
  });
  if (!created) throw AppError.conflict('A refund for this order is already in progress');
  await publish('refund.requested', { refundId: refund._id.toString() });
}

/**
 * Fan-out after an event is cancelled: one refund per paid order. Seats are
 * not restocked — there is nothing left to sell.
 */
export async function refundCancelledEvent(eventId: string): Promise<number> {
  const orders = await OrderModel.find({ eventId, status: 'paid' })
    .select('_id eventId totalMinor razorpayPaymentId')
    .lean();
  let requested = 0;
  for (const order of orders) {
    const { refund, created } = await withTransaction((session) =>
      createRefundInSession(order, 'Event cancelled by organiser', false, session),
    );
    if (created) {
      requested += 1;
      await publish('refund.requested', { refundId: refund._id.toString() });
    }
  }
  logger.info({ eventId, requested }, 'Refunds requested for cancelled event');
  return requested;
}

/**
 * Executes a refund against the gateway. Runs as a retried job.
 *
 * Safe to run any number of times: a processed refund is skipped, and before
 * calling the gateway it looks for a refund already tagged with this row's
 * id — the case where a previous attempt reached Razorpay but crashed before
 * saving the result.
 */
export async function processRefund(refundId: string): Promise<Refund['status']> {
  const refund = await RefundModel.findById(refundId).lean();
  if (!refund) throw new Error(`Refund ${refundId} not found`);
  if (refund.status === 'processed') return 'processed';

  await RefundModel.updateOne({ _id: refund._id }, { $inc: { attempts: 1 } });

  let gatewayRefund: { id: string; status: string } | null = null;
  if (refund.amountMinor > 0 && refund.paymentId) {
    try {
      const gateway = getPaymentGateway();
      const previous = (await gateway.listRefunds(refund.paymentId)).find(
        (r) => String(r.notes.refundId) === refund._id.toString(),
      );
      gatewayRefund =
        previous ??
        (await gateway.refund({
          paymentId: refund.paymentId,
          amountMinor: refund.amountMinor,
          notes: { refundId: refund._id.toString(), orderId: refund.orderId.toString() },
        }));
    } catch (err) {
      await RefundModel.updateOne({ _id: refund._id }, { $set: { lastError: String(err) } });
      throw err;
    }
    if (gatewayRefund.status === 'failed') {
      await RefundModel.updateOne(
        { _id: refund._id },
        {
          $set: {
            status: 'failed',
            razorpayRefundId: gatewayRefund.id,
            lastError: 'Gateway reported failure',
          },
        },
      );
      logger.error({ refundId }, 'Gateway reported refund failure; needs manual attention');
      return 'failed';
    }
  }

  // Razorpay accepts refunds as "pending" and settles them later; the refund.processed
  // webhook moves our row to processed. Either way the money is committed to go back.
  const status: Refund['status'] =
    gatewayRefund && gatewayRefund.status !== 'processed' ? 'pending' : 'processed';
  const tierIds = await withTransaction(async (session) => {
    const claimed = await OrderModel.findOneAndUpdate(
      { _id: refund.orderId, status: { $in: ['paid', 'failed'] } },
      { $set: { status: 'refunded', refundedAt: new Date() } },
      { session },
    ).lean();

    await RefundModel.updateOne(
      { _id: refund._id },
      {
        $set: {
          status,
          razorpayRefundId: gatewayRefund?.id ?? null,
          lastError: null,
          ...(status === 'processed' ? { processedAt: new Date() } : {}),
        },
      },
      { session },
    );

    // Restock only on the first transition from paid, and only for an order whose seats were sold.
    if (claimed?.status !== 'paid' || !refund.restock) return [];
    for (const item of claimed.items) {
      await TicketTierModel.updateOne(
        { _id: item.tierId, quantitySold: { $gte: item.quantity } },
        { $inc: { quantitySold: -item.quantity } },
        { session },
      );
    }
    return claimed.items.map((i) => i.tierId.toString());
  });

  if (tierIds.length > 0) {
    await publish('inventory.changed', { eventId: refund.eventId.toString(), tierIds });
  }
  return status;
}

export async function markRefundSettled(
  razorpayRefundId: string,
  outcome: 'processed' | 'failed',
): Promise<void> {
  await RefundModel.updateOne(
    { razorpayRefundId, status: { $ne: 'processed' } },
    { $set: { status: outcome, ...(outcome === 'processed' ? { processedAt: new Date() } : {}) } },
  );
}

export async function listEventOrders(
  auth: AuthContext,
  eventId: string,
): Promise<OrganiserOrder[]> {
  const event = await EventModel.findById(eventId).select('organiserId').lean();
  assertCanManage(event?.organiserId, auth);

  const orders = await OrderModel.find({ eventId, status: { $in: ['paid', 'refunded', 'failed'] } })
    .sort({ createdAt: -1 })
    .limit(1000)
    .lean();
  const [buyers, refunds] = await Promise.all([
    UserModel.find({ _id: { $in: orders.map((o) => o.userId) } })
      .select('name email')
      .lean(),
    RefundModel.find({ orderId: { $in: orders.map((o) => o._id) } }).lean(),
  ]);
  const buyerById = new Map(buyers.map((b) => [b._id.toString(), b]));
  const refundByOrder = new Map(refunds.map((r) => [r.orderId.toString(), r]));

  return orders.map((o) => {
    const buyer = buyerById.get(o.userId.toString());
    const refund = refundByOrder.get(o._id.toString());
    return {
      id: o._id.toString(),
      buyer: {
        id: o.userId.toString(),
        name: buyer?.name ?? 'Deleted user',
        email: buyer?.email ?? '',
      },
      status: o.status,
      totalMinor: o.totalMinor,
      seats: o.items.reduce((n, i) => n + i.quantity, 0),
      promoCode: o.promoCode,
      paidAt: o.paidAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      refund: refund ? { status: refund.status, amountMinor: refund.amountMinor } : null,
    };
  });
}
