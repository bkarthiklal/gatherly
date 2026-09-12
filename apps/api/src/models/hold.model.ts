import { HOLD_STATUSES, type HoldStatus } from '@gatherly/types';
import { Schema, model, type Types } from 'mongoose';

/**
 * A temporary claim on seats while the buyer checks out.
 *
 * Invariant: for every tier, quantityHeld equals the sum of `quantity` over
 * its active holds. Creating, releasing and expiring a hold each change the
 * hold and the tier's counter in one transaction, so the invariant holds in
 * every committed state.
 *
 * Why not simply a TTL index on expiresAt: MongoDB's TTL monitor deletes the
 * document silently, without decrementing the tier's counter, so those seats
 * would be lost from sale forever. Expiry is therefore done by our own code
 * (a delayed job per hold, plus a periodic sweeper). The TTL index here only
 * garbage-collects holds that are already finished.
 */
export interface Hold {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  eventId: Types.ObjectId;
  tierId: Types.ObjectId;
  tierName: string;
  quantity: number;
  unitPriceMinor: number;
  status: HoldStatus;
  orderId: Types.ObjectId | null;
  expiresAt: Date;
  /** Set when the hold leaves `active`; drives clean-up of old documents. */
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const holdSchema = new Schema<Hold>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    tierId: { type: Schema.Types.ObjectId, ref: 'TicketTier', required: true },
    tierName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceMinor: { type: Number, required: true, min: 0 },
    status: { type: String, enum: HOLD_STATUSES, default: 'active', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    expiresAt: { type: Date, required: true },
    finalizedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Per-user limit checks and "my holds".
holdSchema.index({ userId: 1, tierId: 1, status: 1 });
// The sweeper's scan for overdue holds.
holdSchema.index({ status: 1, expiresAt: 1 });
holdSchema.index({ orderId: 1 });
// Garbage collection of finished holds a week after they finish.
holdSchema.index(
  { finalizedAt: 1 },
  {
    expireAfterSeconds: 7 * 24 * 60 * 60,
    partialFilterExpression: { finalizedAt: { $type: 'date' } },
  },
);

export const HoldModel = model<Hold>('Hold', holdSchema);
