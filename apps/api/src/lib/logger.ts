import pino from 'pino';
import { env, isProduction, isTest } from '../config/env.js';

/**
 * Redaction is not cosmetic. Logs are routinely shipped to third-party
 * aggregators and retained far longer than the data itself, so anything
 * that could carry a credential or a session is stripped at the source
 * rather than trusting every call site to omit it.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.refreshToken',
  '*.password',
  '*.passwordHash',
  '*.accessToken',
  '*.refreshToken',
];

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  // Pretty output locally; newline-delimited JSON in production, which is
  // what Render's log pipeline can actually parse and index.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});
