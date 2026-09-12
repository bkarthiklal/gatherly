import type { RefundOrderInput, VerifyPaymentInput } from '@gatherly/types';
import type { Request, RequestHandler } from 'express';
import { getAuth } from '../middleware/auth.js';
import { auditFromRequest } from '../services/audit.service.js';
import * as payments from '../services/payment.service.js';
import * as refunds from '../services/refund.service.js';
import * as tickets from '../services/ticket.service.js';

export const startCheckout: RequestHandler = async (req, res) => {
  res.json(await payments.startCheckout(getAuth(req), req.params.orderId as string));
};

export const verifyCheckout: RequestHandler = async (req, res) => {
  res.json(
    await payments.verifyCheckoutPayment(
      getAuth(req),
      req.params.orderId as string,
      req.body as VerifyPaymentInput,
    ),
  );
};

/**
 * Always answers quickly. 2xx tells Razorpay to stop retrying, so it is
 * returned for processed, duplicate and ignored deliveries alike; an
 * unexpected error returns 5xx so Razorpay tries again later.
 */
export const razorpayWebhook: RequestHandler = async (req: Request, res) => {
  const result = await payments.handleRazorpayWebhook(
    req.body as Buffer,
    req.get('x-razorpay-signature'),
    req.get('x-razorpay-event-id'),
  );
  res.status(200).json({ status: result });
};

export const listTickets: RequestHandler = async (req, res) => {
  res.json({ items: await tickets.listMyTickets(getAuth(req)) });
};

export const getTicket: RequestHandler = async (req, res) => {
  res.json(await tickets.getMyTicket(getAuth(req), req.params.ticketId as string));
};

export const ticketPdf: RequestHandler = async (req, res) => {
  const { filename, pdf } = await tickets.myTicketPdf(getAuth(req), req.params.ticketId as string);
  res
    .status(200)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    })
    .send(pdf);
};

export const listEventOrders: RequestHandler = async (req, res) => {
  res.json({ items: await refunds.listEventOrders(getAuth(req), req.params.eventId as string) });
};

export const refundOrder: RequestHandler = async (req, res) => {
  await refunds.refundOrder(
    getAuth(req),
    req.params.eventId as string,
    req.params.orderId as string,
    (req.body as RefundOrderInput).reason,
  );
  await auditFromRequest(req, 'order.refund', 'order', req.params.orderId as string, {
    eventId: req.params.eventId,
    reason: (req.body as RefundOrderInput).reason,
  });
  res.status(202).json({ status: 'refund-requested' });
};
