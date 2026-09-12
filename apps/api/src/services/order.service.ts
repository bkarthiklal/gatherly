import { type CreateOrderInput, type Order as OrderDto, type OrderQuote } from '@gatherly/types';
import { Types, type ClientSession } from 'mongoose';
import { withTransaction } from '../lib/db.js';
import { publish } from '../lib/domain-events.js';
import { AppError } from '../lib/errors.js';
import type { AuthContext } from '../middleware/auth.js';
import { EventModel } from '../models/event.model.js';
import { HoldModel, type Hold } from '../models/hold.model.js';
import { OrderModel, type Order } from '../models/order.model.js';
import type { PromoCode } from '../models/promo-code.model.js';
import { releaseOrderResources } from './inventory.service.js';
import { consumePromo, discountFor, findUsablePromo } from './promo.service.js';

/** A reservation must have at least this long left to be worth starting payment. */
const MIN_REMAINING_MS = 15_000;

export function toOrderDto(order: Order): OrderDto {
  return {
    id: order._id.toString(),
    eventId: order.eventId.toString(),
    eventTitle: order.eventTitle,
    items: order.items.map((i) => ({
      tierId: i.tierId.toString(),
      tierName: i.tierName,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
    })),
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    totalMinor: order.totalMinor,
    currency: order.currency,
    promoCode: order.promoCode,
    status: order.status,
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

interface PricedHolds {
  holds: Hold[];
  eventId: Types.ObjectId;
  eventTitle: string;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  promo: PromoCode | null;
}

async function priceHolds(
  auth: AuthContext,
  input: CreateOrderInput,
  session?: ClientSession,
): Promise<PricedHolds> {
  const ids = [...new Set(input.holdIds)];
  if (ids.length !== input.holdIds.length)
    throw AppError.badRequest('Duplicate reservation in order');

  const holds = await HoldModel.find({ _id: { $in: ids }, userId: auth.userId })
    .session(session ?? null)
    .lean();
  if (holds.length !== ids.length) throw AppError.notFound('Reservation not found');

  const cutoff = new Date(Date.now() + MIN_REMAINING_MS);
  for (const hold of holds) {
    if (hold.status !== 'active' || hold.expiresAt <= cutoff) {
      throw AppError.holdExpired();
    }
    if (hold.orderId) throw AppError.conflict('A reservation is already part of another order');
  }

  const eventId = holds[0]!.eventId;
  if (holds.some((h) => !h.eventId.equals(eventId))) {
    throw AppError.badRequest('All reservations in an order must be for the same event');
  }

  const event = await EventModel.findById(eventId)
    .select('title status startsAt')
    .session(session ?? null)
    .lean();
  if (event?.status !== 'published' || event.startsAt <= new Date()) {
    throw AppError.conflict('This event is no longer on sale');
  }

  const subtotalMinor = holds.reduce((sum, h) => sum + h.unitPriceMinor * h.quantity, 0);
  const promo = input.promoCode ? await findUsablePromo(eventId, input.promoCode, session) : null;
  const discountMinor = promo ? discountFor(promo, subtotalMinor) : 0;

  return {
    holds,
    eventId,
    eventTitle: event.title,
    subtotalMinor,
    discountMinor,
    totalMinor: subtotalMinor - discountMinor,
    promo,
  };
}

/** Prices a basket without consuming anything — drives the checkout summary. */
export async function quoteOrder(auth: AuthContext, input: CreateOrderInput): Promise<OrderQuote> {
  const priced = await priceHolds(auth, input);
  return {
    items: priced.holds.map((h) => ({
      tierId: h.tierId.toString(),
      tierName: h.tierName,
      quantity: h.quantity,
      unitPriceMinor: h.unitPriceMinor,
    })),
    subtotalMinor: priced.subtotalMinor,
    discountMinor: priced.discountMinor,
    totalMinor: priced.totalMinor,
    currency: 'INR',
    promoCode: priced.promo?.code ?? null,
  };
}

/**
 * Turns active reservations into a pending order.
 *
 * Holds stay active — the seats remain reserved, not sold — until payment is
 * confirmed. The order simply links them and freezes the price. If payment
 * never arrives, the holds expire on schedule and take the order with them.
 */
export async function createOrder(auth: AuthContext, input: CreateOrderInput): Promise<OrderDto> {
  const order = await withTransaction(async (session) => {
    const priced = await priceHolds(auth, input, session);
    if (priced.promo) await consumePromo(priced.promo, session);

    const orderId = new Types.ObjectId();
    const linked = await HoldModel.updateMany(
      {
        _id: { $in: priced.holds.map((h) => h._id) },
        userId: auth.userId,
        status: 'active',
        orderId: null,
      },
      { $set: { orderId } },
      { session },
    );
    // Another request linked one of these holds between our read and write.
    if (linked.modifiedCount !== priced.holds.length) {
      throw AppError.conflict('A reservation is already part of another order');
    }

    const [created] = await OrderModel.create(
      [
        {
          _id: orderId,
          userId: auth.userId,
          eventId: priced.eventId,
          eventTitle: priced.eventTitle,
          items: priced.holds.map((h) => ({
            tierId: h.tierId,
            tierName: h.tierName,
            quantity: h.quantity,
            unitPriceMinor: h.unitPriceMinor,
            holdId: h._id,
          })),
          subtotalMinor: priced.subtotalMinor,
          discountMinor: priced.discountMinor,
          totalMinor: priced.totalMinor,
          promoCodeId: priced.promo?._id ?? null,
          promoCode: priced.promo?.code ?? null,
          expiresAt: new Date(Math.min(...priced.holds.map((h) => h.expiresAt.getTime()))),
        },
      ],
      { session },
    );
    return created!.toObject();
  });

  return toOrderDto(order);
}

export async function getOrderEntity(auth: AuthContext, orderId: string): Promise<Order> {
  const order = await OrderModel.findOne({ _id: orderId, userId: auth.userId }).lean();
  if (!order) throw AppError.notFound('Order not found');
  return order;
}

export async function getOrder(auth: AuthContext, orderId: string): Promise<OrderDto> {
  return toOrderDto(await getOrderEntity(auth, orderId));
}

export async function listMyOrders(auth: AuthContext): Promise<OrderDto[]> {
  const orders = await OrderModel.find({ userId: auth.userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return orders.map(toOrderDto);
}

/** Buyer backs out before paying: seats and promo use go straight back. */
export async function cancelOrder(auth: AuthContext, orderId: string): Promise<OrderDto> {
  const result = await withTransaction(async (session) => {
    const order = await OrderModel.findOneAndUpdate(
      { _id: orderId, userId: auth.userId, status: 'pending' },
      { $set: { status: 'cancelled' } },
      { session, returnDocument: 'after' },
    ).lean();
    if (!order) {
      if (await OrderModel.exists({ _id: orderId, userId: auth.userId }).session(session)) {
        throw AppError.conflict('Only an unpaid order can be cancelled');
      }
      throw AppError.notFound('Order not found');
    }
    const tierIds = await releaseOrderResources(order._id, 'released', session);
    return { order, tierIds };
  });

  await publish('inventory.changed', {
    eventId: result.order.eventId.toString(),
    tierIds: result.tierIds,
  });
  return toOrderDto(result.order);
}
