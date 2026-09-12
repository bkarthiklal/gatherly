import type { AuditQuery, CheckInInput } from '@gatherly/types';
import type { RequestHandler } from 'express';
import { getAuth } from '../middleware/auth.js';
import { getValidatedQuery } from '../middleware/validate.js';
import * as analytics from '../services/analytics.service.js';
import { auditFromRequest, listAuditLogs } from '../services/audit.service.js';
import * as checkins from '../services/checkin.service.js';

export const checkIn: RequestHandler = async (req, res) => {
  const eventId = req.params.eventId as string;
  const result = await checkins.checkIn(getAuth(req), eventId, req.body as CheckInInput);
  await auditFromRequest(req, `ticket.check-in.${result.result}`, 'event', eventId, {
    serial: result.ticket?.serial ?? null,
    method: 'qrPayload' in (req.body as CheckInInput) ? 'qr' : 'serial',
  });
  res.json(result);
};

export const checkInStats: RequestHandler = async (req, res) => {
  res.json(await checkins.getCheckInStats(getAuth(req), req.params.eventId as string));
};

export const eventAnalytics: RequestHandler = async (req, res) => {
  res.json(await analytics.eventAnalytics(getAuth(req), req.params.eventId as string));
};

export const overview: RequestHandler = async (req, res) => {
  res.json(await analytics.organiserOverview(getAuth(req)));
};

export const auditLogs: RequestHandler = async (req, res) => {
  res.json(await listAuditLogs(getValidatedQuery<AuditQuery>(req)));
};
