import { ERROR_CODES, type CreateHoldInput, type Hold as HoldDto } from '@gatherly/types';
import { Types, type ClientSession } from 'mongoose';
import { env } from '../config/env.js';
import { withTransaction } from '../lib/db.js';
import { publish } from '../lib/domain-events.js';
import { AppError } from '../lib/errors.js';
import { withLock } from '../lib/lock.js';
import { logger } from '../lib/logger.js';
import type { AuthContext } from '../middleware/auth.js';
import { EventModel } from '../models/event.model.js';
import { HoldModel, type Hold } from '../models/hold.model.js';
import { OrderModel } from '../models/order.model.js';
import { PromoCodeModel } from '../models/promo-code.model.js';
import { TicketTierModel } from '../models/ticket-tier.model.js';

export function toHoldDto(hold: Hold): HoldDto {
  return {
    id: hold._id.toString(),
    eventId: hold.eventId.toString(),
    tierId: hold.tierId.toString(),
    tierName: hold.tierName,
    quantity: hold.quantity,
    unitPriceMinor: hold.unitPriceMinor,
    status: hold.status,
    orderId: hold.orderId?.toString() ?? null,
    expiresAt: hold.expiresAt.toISOString(),
  };
}

/**
 * Seats a user already has on this tier: active holds plus seats on orders
 * that are pending or paid. Counted inside the caller's transaction so it
 * sees a consistent snapshot.
 */
async function seatsClaimedByUser(
  userId: Types.ObjectId,
  tierId: Types.ObjectId,
  session: ClientSession,
): Promise<number> {
  const [held] = await HoldModel.aggregate<{ total: number }>([
    { $match: { userId, tierId, status: 'active' } },
    { $group: { _id: null, total: { $sum: '$quantity' } } },
  ]).session(session);

  const [bought] = await OrderModel.aggregate<{ total: number }>([
    { $match: { userId, status: 'paid', 'items.tierId': tierId } },
    { $unwind: '$items' },
    { $match: { 'items.tierId': tierId } },
    { $group: { _id: null, total: { $sum: '$items.quantity' } } },
  ]).session(session);

  return (held?.total ?? 0) + (bought?.total ?? 0);
}

/**
 * Reserves seats for a few minutes while the buyer checks out.
 *
 * Three layers, each covering something the others do not:
 *
 * 1. The guarded atomic update is what makes overselling impossible. The
 *    database evaluates `total − sold − held >= quantity` and applies the
 *    increment as one indivisible operation on the tier document; there is
 *    no gap between checking and writing for another request to slip into.
 *
 * 2. The transaction binds that increment to the Hold insert and the per-user
 *    limit check, so no committed state ever has a counter without its hold,
 *    and two same-user transactions touching the tier conflict rather than
 *    both passing the limit check.
 *
 * 3. The per-user Redis lock stops one user's burst of parallel clicks from
 *    becoming a pile of mutually conflicting transactions that MongoDB then
 *    has to abort and retry. It is an efficiency and fairness layer, not the
 *    correctness guarantee — which is why, if Redis is down, reservations
 *    continue on layers 1 and 2 alone rather than failing.
 */
export async function reserveSeats(auth: AuthContext, input: CreateHoldInput): Promise<HoldDto> {
  const tier = await TicketTierModel.findById(input.tierId).lean();
  if (!tier) throw AppError.notFound('Ticket tier not found');

  const event = await EventModel.findById(tier.eventId).select('status startsAt').lean();
  const now = new Date();
  if (event?.status !== 'published') throw AppError.notFound('Ticket tier not found');
  if (event.startsAt <= now)
    throw new AppError(409, ERROR_CODES.NOT_ON_SALE, 'This event has already started');
  if (
    (tier.salesStartAt && tier.salesStartAt > now) ||
    (tier.salesEndAt && tier.salesEndAt <= now)
  ) {
    throw new AppError(
      409,
      ERROR_CODES.NOT_ON_SALE,
      'Tickets for this tier are not on sale right now',
    );
  }
  if (input.quantity > tier.perUserLimit) {
    throw new AppError(
      409,
      ERROR_CODES.PURCHASE_LIMIT_REACHED,
      `You can buy at most ${tier.perUserLimit} of these`,
    );
  }

  const userId = new Types.ObjectId(auth.userId);
  const hold = await withLock(
    `lock:seats:${auth.userId}:${tier._id.toString()}`,
    () =>
      withTransaction(async (session) => {
        const claimed = await seatsClaimedByUser(userId, tier._id, session);
        if (claimed + input.quantity > tier.perUserLimit) {
          throw new AppError(
            409,
            ERROR_CODES.PURCHASE_LIMIT_REACHED,
            `You can buy at most ${tier.perUserLimit} of these (you already have ${claimed})`,
          );
        }

        const reserved = await TicketTierModel.findOneAndUpdate(
          {
            _id: tier._id,
            $expr: {
              $gte: [
                {
                  $subtract: [{ $subtract: ['$quantityTotal', '$quantitySold'] }, '$quantityHeld'],
                },
                input.quantity,
              ],
            },
          },
          { $inc: { quantityHeld: input.quantity } },
          { session, returnDocument: 'after', projection: { priceMinor: 1, name: 1 } },
        ).lean();
        if (!reserved) throw AppError.soldOut();

        const [created] = await HoldModel.create(
          [
            {
              userId,
              eventId: tier.eventId,
              tierId: tier._id,
              tierName: reserved.name,
              quantity: input.quantity,
              unitPriceMinor: reserved.priceMinor,
              expiresAt: new Date(Date.now() + env.HOLD_TTL_SECONDS * 1000),
            },
          ],
          { session },
        );
        return created!.toObject();
      }),
    { ttlMs: 10_000, waitMs: 5_000, onUnavailable: 'proceed' },
  );

  await Promise.all([
    publish('hold.created', {
      holdId: hold._id.toString(),
      expiresAt: hold.expiresAt,
      eventId: hold.eventId.toString(),
      tierId: hold.tierId.toString(),
    }),
    publish('inventory.changed', {
      eventId: hold.eventId.toString(),
      tierIds: [hold.tierId.toString()],
    }),
  ]);

  return toHoldDto(hold);
}

/**
 * Returns seats to sale. Never lets the counter go negative: if the guard
 * fails the invariant was already broken elsewhere, so it is logged loudly
 * and left for `reconcileHeldCounts` rather than compounded.
 */
async function decrementHeld(
  tierId: Types.ObjectId,
  quantity: number,
  session: ClientSession,
): Promise<void> {
  const result = await TicketTierModel.updateOne(
    { _id: tierId, quantityHeld: { $gte: quantity } },
    { $inc: { quantityHeld: -quantity } },
    { session },
  );
  if (result.modifiedCount === 0) {
    logger.error(
      { tierId: tierId.toString(), quantity },
      'quantityHeld would go negative; leaving for reconciliation',
    );
  }
}

/**
 * Releases every still-active hold on an order and returns its promo-code
 * use. Shared by expiry, cancellation and payment failure.
 */
export async function releaseOrderResources(
  orderId: Types.ObjectId,
  holdStatus: 'released' | 'expired',
  session: ClientSession,
): Promise<string[]> {
  const order = await OrderModel.findById(orderId)
    .select('items promoCodeId')
    .session(session)
    .lean();
  if (!order) return [];

  const now = new Date();
  const tierIds: string[] = [];
  for (const item of order.items) {
    const released = await HoldModel.findOneAndUpdate(
      { _id: item.holdId, status: 'active' },
      { $set: { status: holdStatus, finalizedAt: now } },
      { session },
    ).lean();
    if (released) {
      await decrementHeld(released.tierId, released.quantity, session);
      tierIds.push(released.tierId.toString());
    }
  }

  if (order.promoCodeId) {
    await PromoCodeModel.updateOne(
      { _id: order.promoCodeId, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
      { session },
    );
  }
  return tierIds;
}

/** Buyer abandons a reservation that is not yet part of an order. */
export async function releaseHold(auth: AuthContext, holdId: string): Promise<void> {
  const hold = await withTransaction(async (session) => {
    const existing = await HoldModel.findOne({ _id: holdId, userId: auth.userId })
      .session(session)
      .lean();
    if (!existing) throw AppError.notFound('Reservation not found');
    if (existing.orderId)
      throw AppError.conflict('This reservation is part of an order — cancel the order instead');

    const released = await HoldModel.findOneAndUpdate(
      { _id: holdId, status: 'active', orderId: null },
      { $set: { status: 'released', finalizedAt: new Date() } },
      { session },
    ).lean();
    if (!released) throw AppError.conflict('This reservation is no longer active');
    await decrementHeld(released.tierId, released.quantity, session);
    return released;
  });

  await publish('inventory.changed', {
    eventId: hold.eventId.toString(),
    tierIds: [hold.tierId.toString()],
  });
}

/**
 * Expires one hold if it is overdue. Idempotent: the conditional update only
 * matches an active, overdue hold, so the delayed job and the sweeper can
 * both fire for the same hold and only one of them does anything.
 *
 * If the hold belongs to an unpaid order, that order can no longer be
 * fulfilled in full, so the whole order expires and its other holds and
 * promo-code use are released with it.
 */
export async function expireHold(holdId: string, now = new Date()): Promise<boolean> {
  const outcome = await withTransaction(async (session) => {
    const hold = await HoldModel.findOneAndUpdate(
      { _id: holdId, status: 'active', expiresAt: { $lte: now } },
      { $set: { status: 'expired', finalizedAt: now } },
      { session },
    ).lean();
    if (!hold) return null;

    await decrementHeld(hold.tierId, hold.quantity, session);
    const tierIds = [hold.tierId.toString()];

    if (hold.orderId) {
      const order = await OrderModel.findOneAndUpdate(
        { _id: hold.orderId, status: 'pending' },
        {
          $set: {
            status: 'expired',
            failureReason: 'Reservation expired before payment completed',
          },
        },
        { session },
      ).lean();
      if (order) tierIds.push(...(await releaseOrderResources(order._id, 'expired', session)));
    }
    return { eventId: hold.eventId.toString(), tierIds };
  });

  if (!outcome) return false;
  await publish('inventory.changed', {
    eventId: outcome.eventId,
    tierIds: [...new Set(outcome.tierIds)],
  });
  return true;
}

/** Safety net for expiry jobs that were lost (Redis flushed, process asleep on a free tier). */
export async function sweepExpiredHolds(now = new Date(), batchSize = 200): Promise<number> {
  const overdue = await HoldModel.find({ status: 'active', expiresAt: { $lte: now } })
    .select('_id')
    .limit(batchSize)
    .lean();
  let expired = 0;
  for (const { _id } of overdue) {
    if (await expireHold(_id.toString(), now)) expired += 1;
  }
  if (expired > 0) logger.info({ expired }, 'Sweeper expired overdue holds');
  return expired;
}

/**
 * Recomputes quantityHeld from active holds and corrects any drift.
 *
 * In normal operation there is none — every change is transactional. This
 * exists for the abnormal: a manual database edit, a bug. Each correction
 * runs in a transaction, so a reservation committing concurrently conflicts
 * with it on the tier document and one of them retries against fresh data.
 */
export async function reconcileHeldCounts(): Promise<number> {
  const candidates = await TicketTierModel.find({ quantityHeld: { $gt: 0 } })
    .select('_id')
    .lean();
  const withActiveHolds = await HoldModel.distinct('tierId', { status: 'active' });
  const tierIds = new Map<string, Types.ObjectId>();
  for (const t of candidates) tierIds.set(t._id.toString(), t._id);
  for (const id of withActiveHolds) tierIds.set(id.toString(), id);

  let corrected = 0;
  for (const tierId of tierIds.values()) {
    const fixed = await withTransaction(async (session) => {
      const [sum] = await HoldModel.aggregate<{ total: number }>([
        { $match: { tierId, status: 'active' } },
        { $group: { _id: null, total: { $sum: '$quantity' } } },
      ]).session(session);
      const expected = sum?.total ?? 0;
      const tier = await TicketTierModel.findById(tierId)
        .select('quantityHeld')
        .session(session)
        .lean();
      if (!tier || tier.quantityHeld === expected) return false;

      logger.warn(
        { tierId: tierId.toString(), stored: tier.quantityHeld, expected },
        'Correcting quantityHeld drift',
      );
      await TicketTierModel.updateOne(
        { _id: tierId },
        { $set: { quantityHeld: expected } },
        { session },
      );
      return true;
    });
    if (fixed) corrected += 1;
  }
  return corrected;
}

export async function listMyHolds(auth: AuthContext): Promise<HoldDto[]> {
  const holds = await HoldModel.find({
    userId: auth.userId,
    status: 'active',
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();
  return holds.map(toHoldDto);
}
