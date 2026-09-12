import {
  adminEventsQuerySchema,
  createEventSchema,
  createTicketTierSchema,
  eventIdParamsSchema,
  listEventsQuerySchema,
  rejectEventSchema,
  slugParamsSchema,
  tierParamsSchema,
  updateEventSchema,
  updateTicketTierSchema,
} from '@gatherly/types';
import { Router } from 'express';
import * as ctrl from '../controllers/event.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

/** Anyone, signed in or not. */
export const publicEventRouter: Router = Router();
publicEventRouter.get('/', validate(listEventsQuerySchema, 'query'), ctrl.listPublic);
publicEventRouter.get('/:slug', validate(slugParamsSchema, 'params'), ctrl.getPublic);

/**
 * An organiser's own events. Every handler below also runs an ownership
 * check in the service layer — the role gate here is only the first filter.
 */
export const organiserRouter: Router = Router();
organiserRouter.use(requireAuth, requireRole('organiser', 'admin'));
organiserRouter.post('/uploads/banner-signature', ctrl.bannerSignature);
organiserRouter.get('/events', ctrl.listMine);
organiserRouter.post('/events', validate(createEventSchema), ctrl.create);
organiserRouter.get('/events/:eventId', validate(eventIdParamsSchema, 'params'), ctrl.getMine);
organiserRouter.patch(
  '/events/:eventId',
  validate(eventIdParamsSchema, 'params'),
  validate(updateEventSchema),
  ctrl.update,
);
organiserRouter.delete('/events/:eventId', validate(eventIdParamsSchema, 'params'), ctrl.remove);
organiserRouter.post(
  '/events/:eventId/submit',
  validate(eventIdParamsSchema, 'params'),
  ctrl.submit,
);
organiserRouter.post(
  '/events/:eventId/cancel',
  validate(eventIdParamsSchema, 'params'),
  ctrl.cancel,
);
organiserRouter.post(
  '/events/:eventId/tiers',
  validate(eventIdParamsSchema, 'params'),
  validate(createTicketTierSchema),
  ctrl.addTier,
);
organiserRouter.patch(
  '/events/:eventId/tiers/:tierId',
  validate(tierParamsSchema, 'params'),
  validate(updateTicketTierSchema),
  ctrl.updateTier,
);
organiserRouter.delete(
  '/events/:eventId/tiers/:tierId',
  validate(tierParamsSchema, 'params'),
  ctrl.removeTier,
);

/** Moderation. */
export const adminEventRouter: Router = Router();
adminEventRouter.use(requireAuth, requireRole('admin'));
adminEventRouter.get('/events', validate(adminEventsQuerySchema, 'query'), ctrl.listForReview);
adminEventRouter.post(
  '/events/:eventId/approve',
  validate(eventIdParamsSchema, 'params'),
  ctrl.approve,
);
adminEventRouter.post(
  '/events/:eventId/reject',
  validate(eventIdParamsSchema, 'params'),
  validate(rejectEventSchema),
  ctrl.reject,
);
