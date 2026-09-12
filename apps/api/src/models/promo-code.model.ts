import { PROMO_TYPES } from '@gatherly/types';
import { Schema, model, type Types } from 'mongoose';

export interface PromoCode {
  _id: Types.ObjectId;
  eventId: Types.ObjectId;
  code: string;
  type: (typeof PROMO_TYPES)[number];
  value: number;
  /** Null means unlimited. */
  maxUses: number | null;
  /**
   * Counts redemptions by orders that are pending or paid. Incremented with a
   * guard (`usedCount < maxUses`) in the same atomic update, so two buyers
   * racing for the last use cannot both get it. Released again if the order
   * expires, is cancelled or fails.
   */
  usedCount: number;
  active: boolean;
  validFrom: Date | null;
  validTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const promoCodeSchema = new Schema<PromoCode>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    type: { type: String, enum: PROMO_TYPES, required: true },
    value: { type: Number, required: true, min: 1 },
    maxUses: { type: Number, default: null },
    usedCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
  },
  { timestamps: true },
);

promoCodeSchema.index({ eventId: 1, code: 1 }, { unique: true });

export const PromoCodeModel = model<PromoCode>('PromoCode', promoCodeSchema);
