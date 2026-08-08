import { z } from 'zod';
import { objectIdSchema } from './common.js';

export const USER_ROLES = ['attendee', 'organiser', 'admin'] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

/**
 * Order matters here. Zod runs format validation before transforms, so
 * `z.email().trim()` rejects a pasted "  me@example.com " with a confusing
 * "invalid email" message. Normalising first and piping into the format
 * check means users get the benefit of the doubt on whitespace and case,
 * and the database only ever sees one canonical form of an address —
 * which is also what makes the unique index on email trustworthy.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('must be a valid email address').max(254)); // 254 = RFC 5321 ceiling

/**
 * Length floor follows current NIST SP 800-63B guidance: length is the
 * control that matters, so we require 12 characters and deliberately do
 * NOT impose composition rules (one upper, one symbol, …), which push
 * users toward predictable patterns like "Password1!".
 *
 * The upper bound exists because Argon2id hashes the full input — without
 * a cap, a multi-megabyte password becomes a cheap denial-of-service.
 */
export const passwordSchema = z
  .string()
  .min(12, 'must be at least 12 characters')
  .max(128, 'must be at most 128 characters');

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'must be at least 2 characters').max(80),
  email: emailSchema,
  password: passwordSchema,
  /**
   * Self-service registration is limited to these two roles. Admin is
   * provisioned out of band — accepting it here would be a trivial
   * privilege-escalation hole.
   */
  role: z.enum(['attendee', 'organiser']).default('attendee'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Safe projection of a user — never includes passwordHash or token hashes. */
export const publicUserSchema = z.object({
  id: objectIdSchema,
  name: z.string(),
  email: z.email(),
  role: userRoleSchema,
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authResponseSchema = z.object({
  user: publicUserSchema,
  accessToken: z.string(),
  /** Seconds until `accessToken` expires, so the client can refresh ahead of time. */
  expiresIn: z.number(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/**
 * Claims carried inside the access token. Deliberately minimal: `role` is
 * included so routine authorisation needs no database round-trip, but
 * anything that must be revocable in real time (account suspension) is
 * checked against the database instead of trusted from here.
 */
export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  /** Token version — bumped on password change to invalidate issued tokens. */
  tv: number;
  iat: number;
  exp: number;
}
