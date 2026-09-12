import express, { type Express } from 'express';
import { pinoHttp } from 'pino-http';
import { env, isProduction } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import {
  cookies,
  corsMiddleware,
  globalRateLimit,
  sanitizeRequest,
  securityHeaders,
} from './middleware/security.js';
import { authRouter } from './routes/auth.routes.js';
import { adminEventRouter, organiserRouter, publicEventRouter } from './routes/event.routes.js';
import { healthRouter } from './routes/health.routes.js';
import {
  adminAuditRouter,
  eventOpsRouter,
  organiserOverviewRouter,
} from './routes/organiser.routes.js';
import {
  checkoutRouter,
  organiserOrderRouter,
  ticketRouter,
  webhookRouter,
} from './routes/payment.routes.js';
import { holdRouter, orderRouter, promoRouter } from './routes/purchase.routes.js';

/**
 * Builds the application without binding a port, so integration tests can hand
 * it straight to Supertest while `server.ts` owns the listening socket and the
 * database connection.
 *
 * Middleware order is deliberate:
 *   helmet   — headers on every response, including errors raised later
 *   cors     — must answer preflight before anything can reject the request
 *   logging  — early, so every request below is recorded
 *   health   — before the limiter, so platform probes are never throttled
 *   webhooks — before the JSON parser, which would consume the raw bytes the
 *              signature is computed over; not rate-limited, since Razorpay
 *              retries are legitimate and signatures already gate access
 *   cookies  — authentication reads them
 *   json     — body must exist before it can be sanitised
 *   sanitise — operates on the parsed body
 *   limiter  — last gate before routes
 */
export function createApp(): Express {
  const app = express();

  // Render terminates TLS at its proxy (and in production the web app's Netlify
  // rewrite adds a second hop). Without this every request appears to come from
  // the proxy, so the rate limiter would put all users in one bucket and
  // `req.secure` would be false. The exact hop count is trusted — blanket `true`
  // would let a client forge X-Forwarded-For and evade the limiter.
  if (isProduction) app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/healthz' } }));
  app.use(healthRouter);
  app.use('/api/webhooks', webhookRouter);
  app.use(cookies);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(sanitizeRequest);
  app.use(globalRateLimit);

  app.use('/api/auth', authRouter);
  app.use('/api/events', publicEventRouter);
  app.use('/api/organiser/events/:eventId/promo-codes', promoRouter);
  app.use('/api/organiser/events/:eventId/orders', organiserOrderRouter);
  app.use('/api/organiser/events/:eventId', eventOpsRouter);
  app.use('/api/organiser', organiserOverviewRouter);
  app.use('/api/organiser', organiserRouter);
  app.use('/api/holds', holdRouter);
  app.use('/api/orders', checkoutRouter);
  app.use('/api/orders', orderRouter);
  app.use('/api/tickets', ticketRouter);
  app.use('/api/admin', adminAuditRouter);
  app.use('/api/admin', adminEventRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
