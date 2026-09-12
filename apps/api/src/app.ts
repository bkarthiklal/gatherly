import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { isProduction } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { authRouter } from './routes/auth.routes.js';
import { adminEventRouter, organiserRouter, publicEventRouter } from './routes/event.routes.js';
import { healthRouter } from './routes/health.routes.js';
import { holdRouter, orderRouter, promoRouter } from './routes/purchase.routes.js';
import {
  cookies,
  corsMiddleware,
  globalRateLimit,
  sanitizeRequest,
  securityHeaders,
} from './middleware/security.js';

/**
 * Builds the application without binding a port, so integration tests can hand
 * it straight to Supertest while `server.ts` owns the listening socket and the
 * database connection.
 *
 * Middleware order is deliberate:
 *   helmet   — headers on every response, including errors raised later
 *   cors     — must answer preflight before anything can reject the request
 *   cookies  — authentication reads them
 *   json     — body must exist before it can be sanitised
 *   sanitise — operates on the parsed body
 *   logging  — positioned so throttled requests are still recorded
 *   health   — before the limiter, so platform probes are never throttled
 *   limiter  — last gate before routes
 */
export function createApp(): Express {
  const app = express();

  // Render terminates TLS at its proxy. Without this, every request appears to
  // originate from the proxy, so the rate limiter would bucket all users into
  // one counter and `req.secure` would be false. Exactly one hop is trusted —
  // blanket `true` lets a client forge `X-Forwarded-For` and evade the limiter.
  if (isProduction) app.set('trust proxy', 1);

  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(cookies);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(sanitizeRequest);
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' } }));
  app.use(healthRouter);
  app.use(globalRateLimit);

  app.use('/api/auth', authRouter);
  app.use('/api/events', publicEventRouter);
  app.use('/api/organiser/events/:eventId/promo-codes', promoRouter);
  app.use('/api/organiser', organiserRouter);
  app.use('/api/holds', holdRouter);
  app.use('/api/orders', orderRouter);
  app.use('/api/admin', adminEventRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
