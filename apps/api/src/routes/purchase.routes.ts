import {
  createHoldSchema,
  createOrderSchema,
  createPromoCodeSchema,
  eventIdParamsSchema,
  holdIdParamsSchema,
  orderIdParamsSchema,
  promoParamsSchema,
} from '@gatherly/types';
import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/purchase.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { purchaseRateLimit } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';

export const holdRouter: Router = Router();
holdRouter.use(requireAuth);
holdRouter.get('/', ctrl.listHolds);
holdRouter.post('/', purchaseRateLimit, validate(createHoldSchema), ctrl.createHold);
holdRouter.delete('/:holdId', validate(holdIdParamsSchema, 'params'), ctrl.releaseHold);

export const orderRouter: Router = Router();
orderRouter.use(requireAuth);
orderRouter.get('/', ctrl.listOrders);
orderRouter.post('/quote', validate(createOrderSchema), ctrl.quoteOrder);
orderRouter.post('/', purchaseRateLimit, validate(createOrderSchema), ctrl.createOrder);
orderRouter.get('/:orderId', validate(orderIdParamsSchema, 'params'), ctrl.getOrder);
orderRouter.post('/:orderId/cancel', validate(orderIdParamsSchema, 'params'), ctrl.cancelOrder);

/** Mounted under /api/organiser/events/:eventId/promo-codes. */
export const promoRouter: Router = Router({ mergeParams: true });
promoRouter.use(
  requireAuth,
  requireRole('organiser', 'admin'),
  validate(eventIdParamsSchema.loose(), 'params'),
);
promoRouter.get('/', ctrl.listPromos);
promoRouter.post('/', validate(createPromoCodeSchema), ctrl.createPromo);
promoRouter.patch(
  '/:promoId',
  validate(promoParamsSchema, 'params'),
  validate(z.object({ active: z.boolean() })),
  ctrl.setPromoActive,
);
