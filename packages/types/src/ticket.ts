import { z } from 'zod';
import { minorAmountSchema, objectIdSchema } from './common.js';
import { venueSchema } from './event.js';
import { orderStatusSchema } from './order.js';

// ─── Payment ────────────────────────────────────────────────────────────────

/** Everything the browser needs to open Razorpay Checkout for one order. */
export const checkoutSessionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('razorpay'),
    orderId: objectIdSchema,
    keyId: z.string(),
    razorpayOrderId: z.string(),
    amountMinor: minorAmountSchema,
    currency: z.literal('INR'),
    name: z.string(),
    description: z.string(),
    prefill: z.object({ name: z.string(), email: z.string() }),
  }),
  /** Fully discounted orders skip the gateway and are confirmed immediately. */
  z.object({ kind: z.literal('free'), orderId: objectIdSchema, status: orderStatusSchema }),
]);
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>;

/** The three values Razorpay Checkout hands the browser on success. */
export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/, 'invalid signature'),
});
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

// ─── Tickets ────────────────────────────────────────────────────────────────

export const TICKET_STATUSES = ['valid', 'used', 'refunded', 'void'] as const;
export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const ticketSchema = z.object({
  id: objectIdSchema,
  serial: z.string(),
  status: ticketStatusSchema,
  orderId: objectIdSchema,
  eventId: objectIdSchema,
  eventTitle: z.string(),
  eventSlug: z.string(),
  venue: venueSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  tierName: z.string(),
  attendeeName: z.string(),
  checkedInAt: z.iso.datetime().nullable(),
});
export type Ticket = z.infer<typeof ticketSchema>;

export const ticketWithQrSchema = ticketSchema.extend({
  /** The signed string encoded in the QR code. */
  qrPayload: z.string(),
  /** PNG of the QR code as a data: URL, ready for an <img>. */
  qrDataUrl: z.string(),
});
export type TicketWithQr = z.infer<typeof ticketWithQrSchema>;

export const ticketIdParamsSchema = z.object({ ticketId: objectIdSchema });

// ─── Organiser views ────────────────────────────────────────────────────────

export const REFUND_STATUSES = ['pending', 'processed', 'failed'] as const;
export const refundStatusSchema = z.enum(REFUND_STATUSES);
export type RefundStatus = z.infer<typeof refundStatusSchema>;

export const organiserOrderSchema = z.object({
  id: objectIdSchema,
  buyer: z.object({ id: objectIdSchema, name: z.string(), email: z.string() }),
  status: orderStatusSchema,
  totalMinor: minorAmountSchema,
  seats: z.int(),
  promoCode: z.string().nullable(),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  refund: z.object({ status: refundStatusSchema, amountMinor: minorAmountSchema }).nullable(),
});
export type OrganiserOrder = z.infer<typeof organiserOrderSchema>;

export const refundOrderSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});
export type RefundOrderInput = z.infer<typeof refundOrderSchema>;

export const eventOrderParamsSchema = z.object({
  eventId: objectIdSchema,
  orderId: objectIdSchema,
});
