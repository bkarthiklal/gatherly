import {
  ERROR_CODES,
  type CheckoutSession,
  type Order as OrderDto,
  type VerifyPaymentInput,
} from '@gatherly/types';
import type { ClientSession } from 'mongoose';
import { env } from '../config/env.js';
import { withTransaction } from '../lib/db.js';
import { publish } from '../lib/domain-events.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getPaymentGateway } from '../lib/payment-gateway.js';
import { verifyRazorpayPayment, verifyRazorpayWebhook } from '../lib/signatures.js';
import type { AuthContext } from '../middleware/auth.js';
import { EventModel } from '../models/event.model.js';
import { HoldModel } from '../models/hold.model.js';
import { OrderModel, type Order } from '../models/order.model.js';
import { ProcessedWebhookModel } from '../models/processed-webhook.model.js';
import { PromoCodeModel } from '../models/promo-code.model.js';
import { TicketTierModel } from '../models/ticket-tier.model.js';
import { UserModel } from '../models/user.model.js';
import { getOrderEntity, toOrderDto } from './order.service.js';
import { createRefundInSession, markRefundSettled } from './refund.service.js';
import { mintTickets } from './ticket.service.js';

const CHECKOUT_MIN_REMAINING_MS = 30_000;

export interface PaymentProof {
  paymentId: string | null;
  amountMinor: number;
  source: 'webhook' | 'checkout' | 'free';
}

/** Thrown inside the payment transaction when money arrived but seats cannot be delivered. */
class CannotFulfil extends Error {}

type ConfirmOutcome =
  | { kind: 'paid'; order: Order }
  | { kind: 'already-handled'; order: Order }
  | { kind: 'refunding'; order: Order; reason: string }
  | { kind: 'unknown-order' };

/**
 * Moves an order to paid and delivers its seats. The single place that
 * happens, whichever signal arrives first — the webhook, the browser's
 * signed checkout callback, or a free order.
 *
 * Normally each seat moves from held to sold, converting its hold. If the
 * buyer paid after their reservation lapsed (slow bank page, closed laptop),
 * the seats were already released, so we try to sell them again directly
 * against live availability. If that fails, or the amount is wrong, or the
 * event was cancelled meanwhile, the transaction is rolled back and the
 * order is marked failed with an automatic refund instead — money is never
 * kept for seats that were not delivered.
 *
 * `extra` runs inside the same transaction (used to record the webhook id,
 * so recording and applying are atomic).
 */
export async function confirmPayment(
  orderId: string,
  proof: PaymentProof,
  extra?: (session: ClientSession) => Promise<void>,
): Promise<ConfirmOutcome> {
  let outcome: ConfirmOutcome;
  try {
    outcome = await withTransaction(async (session) => {
      await extra?.(session);
      const order = await OrderModel.findById(orderId).session(session).lean();
      if (!order) return { kind: 'unknown-order' } as const;
      if (order.status === 'paid' || order.status === 'refunded')
        return { kind: 'already-handled', order } as const;
      if (order.status === 'failed' && order.razorpayPaymentId === proof.paymentId) {
        return { kind: 'already-handled', order } as const;
      }

      if (proof.amountMinor !== order.totalMinor) {
        throw new CannotFulfil(`Paid ${proof.amountMinor} but order total is ${order.totalMinor}`);
      }
      const event = await EventModel.findById(order.eventId)
        .select('status')
        .session(session)
        .lean();
      if (event?.status !== 'published') throw new CannotFulfil('Event is no longer on sale');

      const now = new Date();
      for (const item of order.items) {
        const converted = await HoldModel.findOneAndUpdate(
          { _id: item.holdId, orderId: order._id, status: 'active' },
          { $set: { status: 'converted', finalizedAt: now } },
          { session },
        ).lean();

        const moved = converted
          ? await TicketTierModel.updateOne(
              { _id: item.tierId, quantityHeld: { $gte: item.quantity } },
              { $inc: { quantityHeld: -item.quantity, quantitySold: item.quantity } },
              { session },
            )
          : // Late payment: the hold already lapsed. Sell again only if seats are still free.
            await TicketTierModel.updateOne(
              {
                _id: item.tierId,
                $expr: {
                  $gte: [
                    {
                      $subtract: [
                        { $subtract: ['$quantityTotal', '$quantitySold'] },
                        '$quantityHeld',
                      ],
                    },
                    item.quantity,
                  ],
                },
              },
              { $inc: { quantitySold: item.quantity } },
              { session },
            );
        if (moved.modifiedCount === 0)
          throw new CannotFulfil(`Seats for ${item.tierName} are no longer available`);
      }

      // A lapsed order had its promo use released; the buyer paid the discounted price, so count it again.
      if (order.status !== 'pending' && order.promoCodeId) {
        await PromoCodeModel.updateOne(
          { _id: order.promoCodeId },
          { $inc: { usedCount: 1 } },
          { session },
        );
      }

      const paid = await OrderModel.findOneAndUpdate(
        { _id: order._id, status: order.status },
        {
          $set: {
            status: 'paid',
            paidAt: now,
            razorpayPaymentId: proof.paymentId,
            failureReason: null,
          },
        },
        { session, returnDocument: 'after' },
      ).lean();
      if (!paid) throw new Error('Order changed during payment confirmation'); // retried by the caller's delivery

      const buyer = await UserModel.findById(order.userId).select('name').session(session).lean();
      await mintTickets(paid, buyer?.name ?? 'Guest', session);
      return { kind: 'paid', order: paid } as const;
    });
  } catch (err) {
    if (!(err instanceof CannotFulfil)) throw err;
    outcome = await failAndRefund(orderId, proof, err.message, extra);
  }

  if (outcome.kind === 'paid') {
    logger.info({ orderId, source: proof.source }, 'Order paid');
    await Promise.all([
      publish('order.paid', { orderId }),
      publish('inventory.changed', {
        eventId: outcome.order.eventId.toString(),
        tierIds: outcome.order.items.map((i) => i.tierId.toString()),
      }),
    ]);
  }
  return outcome;
}

async function failAndRefund(
  orderId: string,
  proof: PaymentProof,
  reason: string,
  extra?: (session: ClientSession) => Promise<void>,
): Promise<ConfirmOutcome> {
  const result = await withTransaction(async (session) => {
    await extra?.(session);
    const order = await OrderModel.findOneAndUpdate(
      { _id: orderId, status: { $in: ['pending', 'expired', 'cancelled'] } },
      { $set: { status: 'failed', failureReason: reason, razorpayPaymentId: proof.paymentId } },
      { session, returnDocument: 'after' },
    ).lean();
    if (!order) {
      const current = await OrderModel.findById(orderId).session(session).lean();
      return current
        ? ({ kind: 'already-handled', order: current } as const)
        : ({ kind: 'unknown-order' } as const);
    }
    const { refund, created } = await createRefundInSession(
      order,
      `Automatic: ${reason}`,
      false,
      session,
    );
    return {
      kind: 'refunding',
      order,
      reason,
      refundId: created ? refund._id.toString() : null,
    } as const;
  });

  if (result.kind === 'refunding') {
    logger.warn({ orderId, reason }, 'Payment received but order cannot be fulfilled; refunding');
    if (result.refundId) await publish('refund.requested', { refundId: result.refundId });
    return { kind: 'refunding', order: result.order, reason: result.reason };
  }
  return result;
}

/** Creates (once) the Razorpay order and returns what Checkout needs. */
export async function startCheckout(auth: AuthContext, orderId: string): Promise<CheckoutSession> {
  const order = await getOrderEntity(auth, orderId);
  if (order.status !== 'pending') throw AppError.conflict('This order is not awaiting payment');
  if (order.expiresAt.getTime() - Date.now() < CHECKOUT_MIN_REMAINING_MS)
    throw AppError.holdExpired();

  if (order.totalMinor === 0) {
    const outcome = await confirmPayment(orderId, {
      paymentId: null,
      amountMinor: 0,
      source: 'free',
    });
    if (outcome.kind === 'unknown-order') throw AppError.notFound('Order not found');
    return { kind: 'free', orderId, status: outcome.order.status };
  }

  const gateway = getPaymentGateway();
  let razorpayOrderId = order.razorpayOrderId;
  if (!razorpayOrderId) {
    const created = await gateway.createOrder({
      amountMinor: order.totalMinor,
      currency: 'INR',
      receipt: order._id.toString(),
      notes: { orderId: order._id.toString(), eventId: order.eventId.toString() },
    });
    // If two checkout clicks raced, keep whichever gateway order was saved first.
    await OrderModel.updateOne(
      { _id: order._id, razorpayOrderId: null },
      { $set: { razorpayOrderId: created.id } },
    );
    razorpayOrderId =
      (await OrderModel.findById(order._id).select('razorpayOrderId').lean())?.razorpayOrderId ??
      null;
  }
  if (!razorpayOrderId) throw AppError.internal();

  const buyer = await UserModel.findById(auth.userId).select('name email').lean();
  const seats = order.items.reduce((n, i) => n + i.quantity, 0);
  return {
    kind: 'razorpay',
    orderId,
    keyId: gateway.keyId,
    razorpayOrderId,
    amountMinor: order.totalMinor,
    currency: 'INR',
    name: 'Gatherly',
    description: `${seats} ticket${seats === 1 ? '' : 's'} · ${order.eventTitle}`,
    prefill: { name: buyer?.name ?? '', email: buyer?.email ?? '' },
  };
}

/**
 * The browser reports success straight from Razorpay Checkout.
 *
 * The signature is HMAC(key_secret, order_id|payment_id), which only Razorpay
 * can produce, so a valid one is proof of payment. This lets the buyer see
 * their tickets immediately. It is not the only path: if the tab closes
 * before this call, the webhook confirms the same order, and confirmPayment
 * is idempotent so doing both delivers one set of tickets.
 */
export async function verifyCheckoutPayment(
  auth: AuthContext,
  orderId: string,
  input: VerifyPaymentInput,
): Promise<OrderDto> {
  const order = await getOrderEntity(auth, orderId);
  const secret = env.RAZORPAY_KEY_SECRET;
  if (!secret)
    throw new AppError(
      503,
      ERROR_CODES.PAYMENT_FAILED,
      'Payments are not configured on this server',
    );

  if (
    !order.razorpayOrderId ||
    input.razorpay_order_id !== order.razorpayOrderId ||
    !verifyRazorpayPayment(
      input.razorpay_order_id,
      input.razorpay_payment_id,
      input.razorpay_signature,
      secret,
    )
  ) {
    throw new AppError(400, ERROR_CODES.PAYMENT_FAILED, 'Payment could not be verified');
  }

  const outcome = await confirmPayment(orderId, {
    paymentId: input.razorpay_payment_id,
    // The Razorpay order was created for exactly this amount, so a verified payment against it matches.
    amountMinor: order.totalMinor,
    source: 'checkout',
  });
  if (outcome.kind === 'unknown-order') throw AppError.notFound('Order not found');
  return toOrderDto(outcome.order);
}

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment?: {
      entity?: { id?: string; order_id?: string; amount?: number; error_description?: string };
    };
    order?: { entity?: { id?: string } };
    refund?: { entity?: { id?: string } };
  };
}

export type WebhookResult = 'processed' | 'duplicate' | 'ignored';

const MONGO_DUPLICATE_KEY = 11000;

/**
 * Authoritative payment signal. Verify the signature over the raw bytes,
 * then record the delivery id and apply its effect in one transaction.
 */
export async function handleRazorpayWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  deliveryId: string | undefined,
): Promise<WebhookResult> {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new AppError(503, ERROR_CODES.PAYMENT_FAILED, 'Webhooks are not configured');
  if (!verifyRazorpayWebhook(rawBody, signature, secret)) {
    throw new AppError(400, ERROR_CODES.PAYMENT_FAILED, 'Invalid webhook signature');
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookBody;
  } catch {
    throw AppError.badRequest('Webhook body is not valid JSON');
  }
  const type = body.event ?? 'unknown';
  if (!deliveryId) throw AppError.badRequest('Missing x-razorpay-event-id');

  const record = async (session: ClientSession) => {
    await ProcessedWebhookModel.create([{ eventId: deliveryId, type }], { session });
  };

  try {
    if (type === 'payment.captured' || type === 'order.paid') {
      const payment = body.payload?.payment?.entity;
      const razorpayOrderId = payment?.order_id ?? body.payload?.order?.entity?.id;
      const order = razorpayOrderId
        ? await OrderModel.findOne({ razorpayOrderId }).select('_id').lean()
        : null;
      if (!order || !payment?.id || typeof payment.amount !== 'number') {
        await withTransaction(record);
        logger.warn({ type, razorpayOrderId }, 'Webhook for an order we do not know; acknowledged');
        return 'ignored';
      }
      await confirmPayment(
        order._id.toString(),
        { paymentId: payment.id, amountMinor: payment.amount, source: 'webhook' },
        record,
      );
      return 'processed';
    }

    if (type === 'payment.failed') {
      const payment = body.payload?.payment?.entity;
      await withTransaction(async (session) => {
        await record(session);
        if (payment?.order_id) {
          await OrderModel.updateOne(
            { razorpayOrderId: payment.order_id, status: 'pending' },
            { $set: { failureReason: payment.error_description ?? 'Payment attempt failed' } },
            { session },
          );
        }
      });
      return 'processed';
    }

    if (type === 'refund.processed' || type === 'refund.failed') {
      const refundId = body.payload?.refund?.entity?.id;
      await withTransaction(record);
      if (refundId)
        await markRefundSettled(refundId, type === 'refund.processed' ? 'processed' : 'failed');
      return 'processed';
    }

    await withTransaction(record);
    return 'ignored';
  } catch (err) {
    if ((err as { code?: number }).code === MONGO_DUPLICATE_KEY) return 'duplicate';
    throw err;
  }
}
