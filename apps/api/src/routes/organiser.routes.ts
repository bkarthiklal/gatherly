import { auditQuerySchema, checkInSchema, eventIdParamsSchema } from '@gatherly/types';
import { Router } from 'express';
import * as ctrl from '../controllers/organiser.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { checkInRateLimit } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';

/** Mounted under /api/organiser/events/:eventId. */
export const eventOpsRouter: Router = Router({ mergeParams: true });
eventOpsRouter.use(
  requireAuth,
  requireRole('organiser', 'admin'),
  validate(eventIdParamsSchema.loose(), 'params'),
);
eventOpsRouter.post('/check-in', checkInRateLimit, validate(checkInSchema), ctrl.checkIn);
eventOpsRouter.get('/check-in/stats', ctrl.checkInStats);
eventOpsRouter.get('/analytics', ctrl.eventAnalytics);

/** Mounted under /api/organiser. */
export const organiserOverviewRouter: Router = Router();
organiserOverviewRouter.get(
  '/overview',
  requireAuth,
  requireRole('organiser', 'admin'),
  ctrl.overview,
);

/** Mounted under /api/admin. */
export const adminAuditRouter: Router = Router();
adminAuditRouter.get(
  '/audit-logs',
  requireAuth,
  requireRole('admin'),
  validate(auditQuerySchema, 'query'),
  ctrl.auditLogs,
);
