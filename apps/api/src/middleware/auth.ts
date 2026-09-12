import type { UserRole } from '@gatherly/types';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { UserModel } from '../models/user.model.js';
import { verifyAccessToken } from '../services/token.service.js';

export interface AuthContext {
  userId: string;
  role: UserRole;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/**
 * Verifies the access token, then confirms against the database that the
 * account still exists and the token has not been outdated by a
 * "log out everywhere" or password change. That lookup is a single indexed
 * read; the payoff is that revocation and role changes take effect on the
 * next request instead of up to 15 minutes later.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw AppError.unauthenticated();

  const claims = verifyAccessToken(token);
  const user = await UserModel.findById(claims.sub).select('role tokenVersion').lean();
  if (user?.tokenVersion !== claims.tv) {
    throw AppError.unauthenticated('Session is no longer valid — please sign in again');
  }

  req.auth = { userId: claims.sub, role: user.role };
  next();
};

export function getAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw new Error(`getAuth called on ${req.method} ${req.path} without requireAuth`);
  }
  return req.auth;
}

/** Proves the caller holds one of the roles. Must run after `requireAuth`. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(getAuth(req).role)) throw AppError.forbidden();
    next();
  };
}

/**
 * Ownership, as distinct from role.
 *
 * `requireRole('organiser')` proves the caller is *an* organiser. It does not
 * prove they own *this* event — skipping that second check is the most common
 * authorisation bug in multi-tenant apps. Admins may manage anything.
 *
 * Resources that don't exist and resources owned by someone else both yield
 * 404, so a caller cannot probe which ids exist.
 */
export function assertCanManage(
  ownerId: { toString(): string } | null | undefined,
  auth: AuthContext,
): void {
  if (auth.role === 'admin') return;
  if (ownerId?.toString() !== auth.userId) throw AppError.notFound();
}

/** Route-level form of `assertCanManage` for handlers that only need the owner id. */
export function requireOwnership(
  getOwnerId: (req: Request) => Promise<{ toString(): string } | null | undefined>,
): RequestHandler {
  return async (req, _res, next) => {
    assertCanManage(await getOwnerId(req), getAuth(req));
    next();
  };
}
