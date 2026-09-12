import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ERROR_CODES, type ApiError } from '@gatherly/types';
import { AppError, isAppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Terminal middleware for unmatched routes. Expressed as a thrown `AppError`
 * rather than a direct response so that 404s travel the same path as every
 * other error and are rendered in one place.
 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Cannot ${req.method} ${req.path}`));
};

interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

/**
 * Recognises the errors `express.json()` throws so they surface as the client
 * mistakes they are. Without this, malformed JSON and oversized payloads fall
 * through to the generic 500 branch and read as server faults.
 */
function fromBodyParser(err: unknown): AppError | null {
  if (!(err instanceof Error)) return null;
  const { type, status, statusCode } = err as BodyParserError;
  const code = status ?? statusCode;

  if (type === 'entity.too.large' || code === 413) {
    return new AppError(413, ERROR_CODES.VALIDATION_FAILED, 'Request body is too large');
  }
  if (type === 'entity.parse.failed' || (code === 400 && err instanceof SyntaxError)) {
    return AppError.badRequest('Request body is not valid JSON');
  }
  return null;
}

/**
 * The single place an error becomes a response.
 *
 * The rule this enforces: an `AppError` carries a message written for a user
 * and is rendered verbatim; anything else is logged with its stack and
 * answered with a generic 500. An unexpected error may embed a driver message,
 * a file path or a connection string, so `err.message` from an unknown error
 * is never returned to the client.
 *
 * Express 5 forwards rejected promises here automatically, which is why
 * controllers need no `try/catch` wrapper.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Express cannot rewrite headers that are already on the wire; handing the
  // error back lets it abort the connection instead of throwing a second time.
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = isAppError(err) ? err : fromBodyParser(err);

  if (appError) {
    const body: ApiError = {
      error: { code: appError.code, message: appError.message },
    };
    if (appError.details) body.error.details = appError.details;

    // 4xx is routine client behaviour and logs at debug; 5xx raised
    // deliberately is a real fault and keeps its stack.
    if (appError.statusCode >= 500) {
      logger.error({ err: appError, req: { method: req.method, url: req.url } }, appError.message);
    } else {
      logger.debug({ code: appError.code, status: appError.statusCode }, appError.message);
    }

    res.status(appError.statusCode).json(body);
    return;
  }

  logger.error(
    { err, req: { method: req.method, url: req.url } },
    'Unhandled error while processing request',
  );

  const body: ApiError = {
    error: { code: ERROR_CODES.INTERNAL, message: 'Something went wrong' },
  };
  res.status(500).json(body);
};
