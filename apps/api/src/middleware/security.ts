import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { CorsOptions } from 'cors';
import mongoSanitize from '@exortek/express-mongo-sanitize';
import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { ERROR_CODES } from '@gatherly/types';
import { env, isTest } from '../config/env.js';
import { AppError } from '../lib/errors.js';

/**
 * Standard header set for a JSON API. The CSP that `helmet()` installs by
 * default is inert here — there is no HTML to constrain — but it is left on
 * because it costs nothing and this server may one day return an error page.
 */
export const securityHeaders: RequestHandler = helmet();

/**
 * Origin is checked against an explicit allowlist; wildcards are deliberately
 * unsupported. `credentials: true` is what lets the refresh-token cookie
 * travel, and the CORS specification forbids pairing that with `*` — so an
 * allowlist is not merely good practice here, it is the only thing that works.
 *
 * A missing `Origin` header is allowed through: that is a non-browser caller
 * (curl, a health probe, the Razorpay webhook), none of which are subject to
 * the same-origin policy that CORS exists to relax. Blocking them would break
 * payments without adding protection.
 */
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || env.CORS_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new AppError(403, ERROR_CODES.FORBIDDEN, 'Origin not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86_400,
};

export const corsMiddleware: RequestHandler = cors(corsOptions);

export const cookies: RequestHandler = cookieParser();

/**
 * Strips MongoDB operators from body, query and params.
 *
 * Second line of defence only. The primary one is Zod validation at the edge,
 * which rejects `{ "$ne": null }` because it is an object where a string was
 * required. This exists for the paths where a schema is permissive.
 *
 * The `@exortek` fork is used rather than `express-mongo-sanitize` because the
 * original assigns to `req.query`, which Express 5 made a read-only getter —
 * it throws on the first request. This fork redefines the property instead.
 */
export const sanitizeRequest: RequestHandler = mongoSanitize({
  sanitizeObjects: ['body', 'query', 'params'],
  replaceWith: '_',
});

/**
 * Rate limiters share this response path so a throttled client sees the same
 * error envelope as every other failure rather than the library's plain text.
 */
function rateLimitHandler(): RequestHandler {
  return (_req, _res, next) => {
    next(
      new AppError(
        429,
        ERROR_CODES.RATE_LIMITED,
        'Too many requests — please wait a moment and try again',
      ),
    );
  };
}

const baseLimiterOptions = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rateLimitHandler(),
  // Integration tests fire hundreds of requests at one route in milliseconds;
  // leaving the limiter armed would make them fail for the wrong reason.
  skip: () => isTest,
} as const;

/**
 * Broad per-IP ceiling. A single-page app makes many small requests, and a
 * campus or demo room shares one IP, so it is generous; the sensitive routes
 * have their own tighter limits. Check-in is exempt here and limited per
 * steward instead — a busy door legitimately scans hundreds of tickets.
 */
export const globalRateLimit: RequestHandler = rateLimit({
  ...baseLimiterOptions,
  limit: 1000,
  skip: (req) => isTest || /^\/api\/organiser\/events\/[^/]+\/check-in$/.test(req.path),
});

/**
 * Applied to login and register. Ten attempts per quarter hour per
 * IP-and-email pair makes online password guessing impractical. Keying on the
 * email as well as the IP means a room of people behind one shared Wi-Fi
 * address (a campus, a demo) do not lock each other out.
 */
export const authRateLimit: RequestHandler = rateLimit({
  ...baseLimiterOptions,
  limit: 10,
  keyGenerator: (req) => {
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    return `${ipKeyGenerator(req.ip ?? '')}:${email}`;
  },
});

/**
 * Refresh is called automatically every few minutes by every open tab, so it
 * gets a looser ceiling than password attempts. It needs no tight limit: the
 * token it guards is 256 random bits and cannot be guessed.
 */
export const refreshRateLimit: RequestHandler = rateLimit({
  ...baseLimiterOptions,
  limit: 60,
});

/**
 * Reservation and order creation, keyed on the signed-in user rather than
 * the IP. Generous for a person, but it caps how fast a single account can
 * sweep inventory into holds — the scalping pattern the per-user ticket limit
 * alone does not stop, because holds expire and can be re-taken.
 */
export const purchaseRateLimit: RequestHandler = rateLimit({
  ...baseLimiterOptions,
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
});

/** Per steward. Roughly two scans a second, sustained, is more than any real door manages. */
export const checkInRateLimit: RequestHandler = rateLimit({
  ...baseLimiterOptions,
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
});
