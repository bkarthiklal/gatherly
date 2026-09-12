import { z } from 'zod';
import { currencySchema, minorAmountSchema, objectIdSchema } from './common.js';

// ─── Holds ──────────────────────────────────────────────────────────────────

export const HOLD_STATUSES = ['active', 'converted', 'released', 'expired'] as const;
export const holdStatusSchema = z.enum(HOLD_STATUSES);
export type HoldStatus = z.infer<typeof holdStatusSchema>;

export const createHoldSchema = z.object({
  tierId: objectIdSchema,
  quantity: z.int().min(1).max(20),
});
export type CreateHoldInput = z.infer<typeof createHoldSchema>;

export const holdSchema = z.object({
  id: objectIdSchema,
  eventId: objectIdSchema,
  tierId: objectIdSchema,
  tierName: z.string(),
  quantity: z.int().positive(),
  /** Price captured when the seats were reserved, so a later price edit cannot change this checkout. */
  unitPriceMinor: minorAmountSchema,
  status: holdStatusSchema,
  orderId: objectIdSchema.nullable(),
  expiresAt: z.iso.datetime(),
});
export type Hold = z.infer<typeof holdSchema>;

// ─── Promo codes ────────────────────────────────────────────────────────────

export const PROMO_TYPES = ['percent', 'fixed'] as const;
export const promoTypeSchema = z.enum(PROMO_TYPES);

/** Codes are compared case-insensitively by storing them upper-cased. */
export const promoCodeStringSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z0-9_-]{3,32}$/, 'use 3–32 letters, digits, - or _'));

export const createPromoCodeSchema = z
  .object({
    code: promoCodeStringSchema,
    type: promoTypeSchema,
    /** Percent (1–100) or paise off. */
    value: z.int().positive(),
    maxUses: z.int().positive().max(1_000_000).nullable().default(null),
    validFrom: z.iso.datetime().optional(),
    validTo: z.iso.datetime().optional(),
  })
  .refine((v) => v.type !== 'percent' || v.value <= 100, {
    message: 'percent cannot exceed 100',
    path: ['value'],
  })
  .refine((v) => !v.validFrom || !v.validTo || new Date(v.validTo) > new Date(v.validFrom), {
    message: 'validTo must be after validFrom',
    path: ['validTo'],
  });
export type CreatePromoCodeInput = z.infer<typeof createPromoCodeSchema>;

export const promoCodeSchema = z.object({
  id: objectIdSchema,
  eventId: objectIdSchema,
  code: z.string(),
  type: promoTypeSchema,
  value: z.int(),
  maxUses: z.int().nullable(),
  usedCount: z.int(),
  active: z.boolean(),
  validFrom: z.iso.datetime().nullable(),
  validTo: z.iso.datetime().nullable(),
});
export type PromoCode = z.infer<typeof promoCodeSchema>;

export const promoParamsSchema = z.object({ eventId: objectIdSchema, promoId: objectIdSchema });

// ─── Orders ─────────────────────────────────────────────────────────────────

export const ORDER_STATUSES = [
  'pending',
  'paid',
  'failed',
  'expired',
  'cancelled',
  'refunded',
] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const createOrderSchema = z.object({
  holdIds: z.array(objectIdSchema).min(1).max(10),
  promoCode: promoCodeStringSchema.optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const orderItemSchema = z.object({
  tierId: objectIdSchema,
  tierName: z.string(),
  quantity: z.int().positive(),
  unitPriceMinor: minorAmountSchema,
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderQuoteSchema = z.object({
  items: z.array(orderItemSchema),
  subtotalMinor: minorAmountSchema,
  discountMinor: minorAmountSchema,
  totalMinor: minorAmountSchema,
  currency: currencySchema,
  promoCode: z.string().nullable(),
});
export type OrderQuote = z.infer<typeof orderQuoteSchema>;

export const orderSchema = orderQuoteSchema.extend({
  id: objectIdSchema,
  eventId: objectIdSchema,
  eventTitle: z.string(),
  status: orderStatusSchema,
  expiresAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Order = z.infer<typeof orderSchema>;

export const orderIdParamsSchema = z.object({ orderId: objectIdSchema });
export const holdIdParamsSchema = z.object({ holdId: objectIdSchema });
