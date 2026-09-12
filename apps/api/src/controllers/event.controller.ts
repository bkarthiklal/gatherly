import type {
  AdminEventsQuery,
  CreateEventInput,
  CreateTicketTierInput,
  ListEventsQuery,
  RejectEventInput,
  UpdateEventInput,
  UpdateTicketTierInput,
} from '@gatherly/types';
import type { Request, RequestHandler } from 'express';
import { getAuth } from '../middleware/auth.js';
import { getValidatedQuery } from '../middleware/validate.js';
import { auditFromRequest } from '../services/audit.service.js';
import * as events from '../services/event.service.js';
import { signBannerUpload } from '../services/upload.service.js';

const eventId = (req: Request): string => req.params.eventId as string;
const tierId = (req: Request): string => req.params.tierId as string;

// Public
export const listPublic: RequestHandler = async (req, res) => {
  res.json(await events.listPublicEvents(getValidatedQuery<ListEventsQuery>(req)));
};

export const getPublic: RequestHandler = async (req, res) => {
  res.json(await events.getPublicEvent(req.params.slug as string));
};

// Organiser
export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await events.createEvent(getAuth(req), req.body as CreateEventInput));
};

export const listMine: RequestHandler = async (req, res) => {
  res.json({ items: await events.listOrganiserEvents(getAuth(req)) });
};

export const getMine: RequestHandler = async (req, res) => {
  res.json(await events.getOrganiserEvent(getAuth(req), eventId(req)));
};

export const update: RequestHandler = async (req, res) => {
  res.json(await events.updateEvent(getAuth(req), eventId(req), req.body as UpdateEventInput));
};

export const submit: RequestHandler = async (req, res) => {
  const result = await events.submitEvent(getAuth(req), eventId(req));
  await auditFromRequest(req, 'event.submit', 'event', eventId(req));
  res.json(result);
};

export const cancel: RequestHandler = async (req, res) => {
  const result = await events.cancelEvent(getAuth(req), eventId(req));
  await auditFromRequest(req, 'event.cancel', 'event', eventId(req));
  res.json(result);
};

export const remove: RequestHandler = async (req, res) => {
  await events.deleteEvent(getAuth(req), eventId(req));
  await auditFromRequest(req, 'event.delete', 'event', eventId(req));
  res.status(204).end();
};

export const addTier: RequestHandler = async (req, res) => {
  res
    .status(201)
    .json(await events.addTier(getAuth(req), eventId(req), req.body as CreateTicketTierInput));
};

export const updateTier: RequestHandler = async (req, res) => {
  res.json(
    await events.updateTier(
      getAuth(req),
      eventId(req),
      tierId(req),
      req.body as UpdateTicketTierInput,
    ),
  );
};

export const removeTier: RequestHandler = async (req, res) => {
  res.json(await events.removeTier(getAuth(req), eventId(req), tierId(req)));
};

export const bannerSignature: RequestHandler = (_req, res) => {
  res.json(signBannerUpload());
};

// Admin
export const listForReview: RequestHandler = async (req, res) => {
  res.json(await events.listEventsForReview(getValidatedQuery<AdminEventsQuery>(req)));
};

export const approve: RequestHandler = async (req, res) => {
  const result = await events.approveEvent(getAuth(req), eventId(req));
  await auditFromRequest(req, 'event.approve', 'event', eventId(req));
  res.json(result);
};

export const reject: RequestHandler = async (req, res) => {
  const result = await events.rejectEvent(
    getAuth(req),
    eventId(req),
    (req.body as RejectEventInput).reason,
  );
  await auditFromRequest(req, 'event.reject', 'event', eventId(req), {
    reason: (req.body as RejectEventInput).reason,
  });
  res.json(result);
};
