import {
  eventIdParamsSchema,
  eventOrderParamsSchema,
  orderIdParamsSchema,
  refundOrderSchema,
  ticketIdParamsSchema,
  verifyPaymentSchema,
} from '@gatherly/types';
import express, { Router } from 'express';
import * as ctrl from '../controllers/payment.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { purchaseRateLimit } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';

/** Mounted under /api/orders alongside the order routes. */
export const checkoutRouter: Router = Router();
checkoutRouter.use(requireAuth);
checkoutRouter.post(
  '/:orderId/pay',
  purchaseRateLimit,
  validate(orderIdParamsSchema, 'params'),
  ctrl.startCheckout,
);
checkoutRouter.post(
  '/:orderId/verify',
  validate(orderIdParamsSchema, 'params'),
  validate(verifyPaymentSchema),
  ctrl.verifyCheckout,
);

/**
 * Mounted before the global JSON parser: signature verification needs the
 * exact bytes Razorpay sent, not a re-serialisation of parsed JSON.
 */
export const webhookRouter: Router = Router();
webhookRouter.post(
  '/razorpay',
  express.raw({ type: 'application/json', limit: '1mb' }),
  ctrl.razorpayWebhook,
);

export const ticketRouter: Router = Router();
ticketRouter.use(requireAuth);
ticketRouter.get('/', ctrl.listTickets);
ticketRouter.get('/:ticketId', validate(ticketIdParamsSchema, 'params'), ctrl.getTicket);
ticketRouter.get('/:ticketId/pdf', validate(ticketIdParamsSchema, 'params'), ctrl.ticketPdf);

/** Mounted under /api/organiser/events/:eventId/orders. */
export const organiserOrderRouter: Router = Router({ mergeParams: true });
organiserOrderRouter.use(requireAuth, requireRole('organiser', 'admin'));
organiserOrderRouter.get(
  '/',
  validate(eventIdParamsSchema.loose(), 'params'),
  ctrl.listEventOrders,
);
organiserOrderRouter.post(
  '/:orderId/refund',
  validate(eventOrderParamsSchema, 'params'),
  validate(refundOrderSchema),
  ctrl.refundOrder,
);
