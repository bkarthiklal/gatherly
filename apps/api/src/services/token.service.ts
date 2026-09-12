import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AccessTokenClaims, UserRole } from '@gatherly/types';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const ISSUER = 'gatherly-api';
const AUDIENCE = 'gatherly-web';

export function signAccessToken(user: {
  id: string;
  role: UserRole;
  tokenVersion: number;
}): string {
  return jwt.sign({ role: user.role, tv: user.tokenVersion }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

/**
 * `algorithms` is pinned. Without it a token claiming `alg: none` — or an
 * asymmetric algorithm keyed with the HMAC secret — could be accepted.
 */
export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw new Error('malformed payload');
    }
    return payload as unknown as AccessTokenClaims;
  } catch {
    throw AppError.unauthenticated('Invalid or expired access token');
  }
}

/** 256 bits from the OS CSPRNG, URL-safe so it survives a cookie untouched. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newTokenFamily(): string {
  return randomUUID();
}

export function refreshTokenExpiry(from = new Date()): Date {
  return new Date(from.getTime() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
