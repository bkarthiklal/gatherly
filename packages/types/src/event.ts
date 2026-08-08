import { z } from 'zod';
import { currencySchema, minorAmountSchema, objectIdSchema } from './common.js';

export const EVENT_STATUSES = ['draft', 'pending', 'published', 'cancelled'] as const;
export const eventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof eventStatusSchema>;

export const EVENT_CATEGORIES = [
  'music',
  'tech',
  'sports',
  'arts',
  'community',
  'education',
  'other',
] as const;
export const eventCategorySchema = z.enum(EVENT_CATEGORIES);
export type EventCategory = z.infer<typeof eventCategorySchema>;

export const venueSchema = z.object({
  name: z.string().trim().min(2).max(120),
  addressLine: z.string().trim().min(4).max(200),
  city: z.string().trim().min(2).max(80),
  /** [longitude, latitude] — GeoJSON order, which is the reverse of how humans say it. */
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).optional(),
});
export type Venue = z.infer<typeof venueSchema>;

export const createTicketTierSchema = z.object({
  name: z.string().trim().min(2).max(60),
  priceMinor: minorAmountSchema,
  currency: currencySchema.default('INR'),
  quantityTotal: z.int().min(1).max(1_000_000),
  /**
   * Anti-scalping control. Capping seats per account raises the cost of
   * bulk acquisition for resale — one of the project's stated aims.
   */
  perUserLimit: z.int().min(1).max(20).default(10),
  salesStartAt: z.iso.datetime().optional(),
  salesEndAt: z.iso.datetime().optional(),
});
export type CreateTicketTierInput = z.infer<typeof createTicketTierSchema>;

export const ticketTierSchema = createTicketTierSchema.extend({
  id: objectIdSchema,
  eventId: objectIdSchema,
  quantitySold: z.int().nonnegative(),
  quantityHeld: z.int().nonnegative(),
  /** Derived: total − sold − held. What a buyer can actually claim right now. */
  quantityAvailable: z.int().nonnegative(),
});
export type TicketTier = z.infer<typeof ticketTierSchema>;

export const createEventSchema = z
  .object({
    title: z.string().trim().min(4).max(140),
    description: z.string().trim().min(20).max(5000),
    category: eventCategorySchema,
    venue: venueSchema,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    bannerUrl: z.url().max(500).optional(),
    tiers: z.array(createTicketTierSchema).min(1, 'an event needs at least one ticket tier').max(10),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  })
  .refine((v) => new Date(v.startsAt) > new Date(), {
    message: 'startsAt must be in the future',
    path: ['startsAt'],
  });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const eventSummarySchema = z.object({
  id: objectIdSchema,
  title: z.string(),
  slug: z.string(),
  category: eventCategorySchema,
  venue: venueSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  bannerUrl: z.url().nullable(),
  status: eventStatusSchema,
  /** Cheapest live tier, for list-view price display. Null when nothing is on sale. */
  fromPriceMinor: minorAmountSchema.nullable(),
});
export type EventSummary = z.infer<typeof eventSummarySchema>;

export const eventDetailSchema = eventSummarySchema.extend({
  description: z.string(),
  organiser: z.object({ id: objectIdSchema, name: z.string() }),
  tiers: z.array(ticketTierSchema),
});
export type EventDetail = z.infer<typeof eventDetailSchema>;

export const listEventsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: eventCategorySchema.optional(),
  city: z.string().trim().max(80).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
