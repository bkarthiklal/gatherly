import type { LoginInput, RegisterInput } from '@gatherly/types';
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { env, isProduction } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { getAuth } from '../middleware/auth.js';
import { UserModel, toPublicUser } from '../models/user.model.js';
import * as authService from '../services/auth.service.js';

export const REFRESH_COOKIE = 'gatherly_rt';

/**
 * The refresh token lives only in this cookie.
 *
 * - httpOnly: page JavaScript cannot read it, so an XSS bug cannot steal it.
 * - path=/api/auth: the browser sends it to auth endpoints and nowhere else.
 * - SameSite=Lax: works because the web app reaches the API through its own
 *   origin (a Vite proxy locally, a Netlify rewrite in production). A
 *   cross-site cookie would need SameSite=None, which Safari blocks outright.
 */
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
};

function clientInfo(req: Request): authService.ClientInfo {
  return { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null };
}

function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}

function sendAuth(res: Response, status: number, result: authService.AuthResult): void {
  res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
  res.status(status).json(result.body);
}

export const register: RequestHandler = async (req, res) => {
  sendAuth(res, 201, await authService.register(req.body as RegisterInput, clientInfo(req)));
};

export const login: RequestHandler = async (req, res) => {
  sendAuth(res, 200, await authService.login(req.body as LoginInput, clientInfo(req)));
};

export const refresh: RequestHandler = async (req, res) => {
  try {
    sendAuth(res, 200, await authService.refresh(readRefreshCookie(req), clientInfo(req)));
  } catch (err) {
    // A dead token must not linger in the browser and be replayed on every page load.
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
    throw err;
  }
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logout(readRefreshCookie(req));
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
};

export const logoutEverywhere: RequestHandler = async (req, res) => {
  await authService.logoutEverywhere(getAuth(req).userId);
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
};

export const me: RequestHandler = async (req, res) => {
  const user = await UserModel.findById(getAuth(req).userId).lean();
  if (!user) throw AppError.unauthenticated();
  res.json({ user: toPublicUser(user) });
};
