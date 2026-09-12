import {
  ERROR_CODES,
  type CreatePromoCodeInput,
  type PromoCode as PromoCodeDto,
} from '@gatherly/types';
import type { ClientSession, Types } from 'mongoose';
import { AppError } from '../lib/errors.js';
import { assertCanManage, type AuthContext } from '../middleware/auth.js';
import { EventModel } from '../models/event.model.js';
import { PromoCodeModel, type PromoCode } from '../models/promo-code.model.js';

export function toPromoDto(promo: PromoCode): PromoCodeDto {
  return {
    id: promo._id.toString(),
    eventId: promo.eventId.toString(),
    code: promo.code,
    type: promo.type,
    value: promo.value,
    maxUses: promo.maxUses,
    usedCount: promo.usedCount,
    active: promo.active,
    validFrom: promo.validFrom?.toISOString() ?? null,
    validTo: promo.validTo?.toISOString() ?? null,
  };
}

async function assertOwnsEvent(auth: AuthContext, eventId: string): Promise<void> {
  const event = await EventModel.findById(eventId).select('organiserId').lean();
  assertCanManage(event?.organiserId, auth);
}

export async function createPromoCode(
  auth: AuthContext,
  eventId: string,
  input: CreatePromoCodeInput,
): Promise<PromoCodeDto> {
  await assertOwnsEvent(auth, eventId);
  try {
    const promo = await PromoCodeModel.create({
      eventId,
      code: input.code,
      type: input.type,
      value: input.value,
      maxUses: input.maxUses,
      validFrom: input.validFrom ? new Date(input.validFrom) : null,
      validTo: input.validTo ? new Date(input.validTo) : null,
    });
    return toPromoDto(promo.toObject());
  } catch (err) {
    if ((err as { code?: number }).code === 11000)
      throw AppError.conflict('This event already has that code');
    throw err;
  }
}

export async function listPromoCodes(auth: AuthContext, eventId: string): Promise<PromoCodeDto[]> {
  await assertOwnsEvent(auth, eventId);
  const promos = await PromoCodeModel.find({ eventId }).sort({ createdAt: -1 }).lean();
  return promos.map(toPromoDto);
}

export async function setPromoActive(
  auth: AuthContext,
  eventId: string,
  promoId: string,
  active: boolean,
): Promise<PromoCodeDto> {
  await assertOwnsEvent(auth, eventId);
  const promo = await PromoCodeModel.findOneAndUpdate(
    { _id: promoId, eventId },
    { $set: { active } },
    { returnDocument: 'after' },
  ).lean();
  if (!promo) throw AppError.notFound('Promo code not found');
  return toPromoDto(promo);
}

export function discountFor(
  promo: Pick<PromoCode, 'type' | 'value'>,
  subtotalMinor: number,
): number {
  const raw =
    promo.type === 'percent' ? Math.floor((subtotalMinor * promo.value) / 100) : promo.value;
  return Math.min(raw, subtotalMinor);
}

const invalid = (message = 'This promo code is not valid for this event') =>
  new AppError(422, ERROR_CODES.PROMO_INVALID, message);

/** Looks a code up without consuming it — for quotes. */
export async function findUsablePromo(
  eventId: Types.ObjectId,
  code: string,
  session?: ClientSession,
): Promise<PromoCode> {
  const now = new Date();
  const promo = await PromoCodeModel.findOne({ eventId, code: code.toUpperCase() })
    .session(session ?? null)
    .lean();
  if (!promo?.active) throw invalid();
  if (promo.validFrom && promo.validFrom > now) throw invalid('This promo code is not active yet');
  if (promo.validTo && promo.validTo <= now) throw invalid('This promo code has expired');
  if (promo.maxUses !== null && promo.usedCount >= promo.maxUses)
    throw invalid('This promo code has been fully used');
  return promo;
}

/**
 * Claims one use. The cap is enforced by the update itself (`usedCount <
 * maxUses` in the filter), so when two buyers race for the last use exactly
 * one update matches.
 */
export async function consumePromo(promo: PromoCode, session: ClientSession): Promise<void> {
  const claimed = await PromoCodeModel.updateOne(
    {
      _id: promo._id,
      active: true,
      $or: [{ maxUses: null }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }],
    },
    { $inc: { usedCount: 1 } },
    { session },
  );
  if (claimed.modifiedCount === 0) throw invalid('This promo code has been fully used');
}
