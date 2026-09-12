import { Schema, model, type Types } from 'mongoose';

/**
 * Inventory lives on its own document, not embedded in the event.
 *
 * Every purchase changes these counters. Keeping them on a small, separate
 * document means a guarded atomic update — "increment held only if enough
 * remain" — touches one tier and never contends with edits to the event's
 * description or with purchases of a different tier.
 *
 * Invariant, enforced by every write: quantitySold + quantityHeld <= quantityTotal.
 */
export interface TicketTier {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  name: string;
  /** Paise. Integers only: floating-point money drifts. */
  priceMinor: number;
  currency: 'INR';
  quantityTotal: number;
  quantitySold: number;
  quantityHeld: number;
  perUserLimit: number;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const ticketTierSchema = new Schema<TicketTier>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true, trim: true },
    priceMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    quantityTotal: { type: Number, required: true, min: 1 },
    quantitySold: { type: Number, default: 0, min: 0 },
    quantityHeld: { type: Number, default: 0, min: 0 },
    perUserLimit: { type: Number, default: 10, min: 1 },
    salesStartAt: { type: Date, default: null },
    salesEndAt: { type: Date, default: null },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

ticketTierSchema.index({ eventId: 1, sortOrder: 1 });

export const TicketTierModel = model<TicketTier>('TicketTier', ticketTierSchema);

export function quantityAvailable(
  tier: Pick<TicketTier, 'quantityTotal' | 'quantitySold' | 'quantityHeld'>,
): number {
  return Math.max(0, tier.quantityTotal - tier.quantitySold - tier.quantityHeld);
}

export function isOnSale(
  tier: Pick<
    TicketTier,
    'quantityTotal' | 'quantitySold' | 'quantityHeld' | 'salesStartAt' | 'salesEndAt'
  >,
  now = new Date(),
): boolean {
  if (tier.salesStartAt && tier.salesStartAt > now) return false;
  if (tier.salesEndAt && tier.salesEndAt <= now) return false;
  return quantityAvailable(tier) > 0;
}
