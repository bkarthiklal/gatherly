import { z } from 'zod';
import { minorAmountSchema, objectIdSchema } from './common.js';

/** A steward either scans the QR or types the serial printed under it. */
export const checkInSchema = z.union([
  z.object({ qrPayload: z.string().trim().min(10).max(200) }),
  z.object({
    serial: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.string().regex(/^GTH-[0-9A-Z]{4}-[0-9A-Z]{4}$/, 'serial looks like GTH-XXXX-XXXX')),
  }),
]);
export type CheckInInput = z.infer<typeof checkInSchema>;

export const CHECK_IN_RESULTS = [
  'admitted',
  'already-used',
  'refunded',
  'wrong-event',
  'invalid',
] as const;
export type CheckInResult = (typeof CHECK_IN_RESULTS)[number];

export const checkInResponseSchema = z.object({
  result: z.enum(CHECK_IN_RESULTS),
  message: z.string(),
  ticket: z
    .object({
      serial: z.string(),
      tierName: z.string(),
      attendeeName: z.string(),
      checkedInAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  stats: z.object({ checkedIn: z.int(), total: z.int() }),
});
export type CheckInResponse = z.infer<typeof checkInResponseSchema>;

export const checkInStatsSchema = z.object({ checkedIn: z.int(), total: z.int() });
export type CheckInStats = z.infer<typeof checkInStatsSchema>;

// ─── Analytics ──────────────────────────────────────────────────────────────

export const eventAnalyticsSchema = z.object({
  eventId: objectIdSchema,
  revenueMinor: minorAmountSchema,
  refundedMinor: minorAmountSchema,
  ordersPaid: z.int(),
  ticketsSold: z.int(),
  capacity: z.int(),
  checkedIn: z.int(),
  tiers: z.array(
    z.object({
      tierId: objectIdSchema,
      name: z.string(),
      sold: z.int(),
      held: z.int(),
      capacity: z.int(),
      revenueMinor: minorAmountSchema,
    }),
  ),
  salesByDay: z.array(
    z.object({ date: z.string(), tickets: z.int(), revenueMinor: minorAmountSchema }),
  ),
  promoCodes: z.array(
    z.object({ code: z.string(), uses: z.int(), discountMinor: minorAmountSchema }),
  ),
});
export type EventAnalytics = z.infer<typeof eventAnalyticsSchema>;

export const organiserOverviewSchema = z.object({
  events: z.int(),
  published: z.int(),
  revenueMinor: minorAmountSchema,
  ticketsSold: z.int(),
  upcoming: z.array(
    z.object({
      id: objectIdSchema,
      title: z.string(),
      startsAt: z.iso.datetime(),
      sold: z.int(),
      capacity: z.int(),
    }),
  ),
});
export type OrganiserOverview = z.infer<typeof organiserOverviewSchema>;

// ─── Audit ──────────────────────────────────────────────────────────────────

export const auditLogSchema = z.object({
  id: objectIdSchema,
  actor: z.object({ id: objectIdSchema, name: z.string() }).nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const auditQuerySchema = z.object({
  action: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
