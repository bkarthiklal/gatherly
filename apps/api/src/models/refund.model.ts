import { REFUND_STATUSES, type RefundStatus } from '@gatherly/types';
import { Schema, model, type Types } from 'mongoose';

/**
 * A refund is recorded before the gateway is called. If the process dies
 * mid-call, the retry finds this row, asks Razorpay whether a refund tagged
 * with this row's id already exists, and records it instead of refunding the
 * buyer twice.
 */
export interface Refund {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  eventId: Types.ObjectId;
  paymentId: string | null;
  amountMinor: number;
  reason: string;
  /** Put seats back on sale — true for a single refund, false when the whole event is cancelled. */
  restock: boolean;
  status: RefundStatus;
  razorpayRefundId: string | null;
  attempts: number;
  lastError: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const refundSchema = new Schema<Refund>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    paymentId: { type: String, default: null },
    amountMinor: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    restock: { type: Boolean, default: true },
    status: { type: String, enum: REFUND_STATUSES, default: 'pending', required: true },
    razorpayRefundId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    processedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// At most one refund per order: a second request finds the first instead of paying out twice.
refundSchema.index({ orderId: 1 }, { unique: true });
refundSchema.index({ status: 1, createdAt: 1 });

export const RefundModel = model<Refund>('Refund', refundSchema);
