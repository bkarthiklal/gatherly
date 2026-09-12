import { ORDER_STATUSES, type OrderStatus } from '@gatherly/types';
import { Schema, model, type Types } from 'mongoose';

export interface OrderItem {
  tierId: Types.ObjectId;
  tierName: string;
  quantity: number;
  unitPriceMinor: number;
  holdId: Types.ObjectId;
}

export interface Order {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  eventId: Types.ObjectId;
  eventTitle: string;
  items: OrderItem[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  currency: 'INR';
  promoCodeId: Types.ObjectId | null;
  promoCode: string | null;
  status: OrderStatus;
  /** When the underlying holds lapse; an unpaid order is dead after this. */
  expiresAt: Date;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  paidAt: Date | null;
  failureReason: string | null;
  refundedAt: Date | null;
  /** Set once the ticket email is accepted by the provider, so a retried job does not send it twice. */
  ticketsEmailedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<OrderItem>(
  {
    tierId: { type: Schema.Types.ObjectId, ref: 'TicketTier', required: true },
    tierName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceMinor: { type: Number, required: true, min: 0 },
    holdId: { type: Schema.Types.ObjectId, ref: 'Hold', required: true },
  },
  { _id: false },
);

const orderSchema = new Schema<Order>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    eventTitle: { type: String, required: true },
    items: { type: [orderItemSchema], required: true },
    subtotalMinor: { type: Number, required: true, min: 0 },
    discountMinor: { type: Number, required: true, min: 0 },
    totalMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['INR'], default: 'INR' },
    promoCodeId: { type: Schema.Types.ObjectId, ref: 'PromoCode', default: null },
    promoCode: { type: String, default: null },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending', required: true },
    expiresAt: { type: Date, required: true },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    paidAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    refundedAt: { type: Date, default: null },
    ticketsEmailedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ eventId: 1, status: 1 });
orderSchema.index({ 'items.tierId': 1, userId: 1, status: 1 });
orderSchema.index(
  { razorpayOrderId: 1 },
  { unique: true, partialFilterExpression: { razorpayOrderId: { $type: 'string' } } },
);

export const OrderModel = model<Order>('Order', orderSchema);
