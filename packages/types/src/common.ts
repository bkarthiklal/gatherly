import { z } from 'zod';

/**
 * A MongoDB ObjectId rendered as a 24-character hex string.
 *
 * Validating this shape at the edge is the primary defence against NoSQL
 * operator injection: a payload like `{ "$ne": null }` is an object, so it
 * fails `z.string()` long before it can reach Mongoose. The sanitiser
 * middleware is defence in depth, not the first line.
 */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'must be a 24-character hex id');

/** Money is stored and transported in minor units (paise) to avoid float drift. */
export const minorAmountSchema = z
  .int()
  .nonnegative()
  .max(100_000_000, 'amount exceeds the per-transaction ceiling');

export const currencySchema = z.literal('INR');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Every error response the API emits uses this shape, so the client has
 * exactly one branch to handle rather than guessing per endpoint.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Field-level detail, present only for validation failures. */
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  SOLD_OUT: 'SOLD_OUT',
  HOLD_EXPIRED: 'HOLD_EXPIRED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  TICKET_ALREADY_USED: 'TICKET_ALREADY_USED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
