import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validates one part of the request against a Zod schema and replaces it
 * with the *parsed* value, so downstream handlers receive coerced, trimmed,
 * defaulted data rather than raw strings.
 *
 * This is the project's primary defence against NoSQL operator injection.
 * A payload such as `{ "email": { "$ne": null } }` fails `z.string()` here
 * and never reaches Mongoose; the sanitiser middleware is a second layer,
 * not the first.
 */
export function validate(schema: ZodType, source: Source = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.') || source,
        message: issue.message,
      }));
      next(AppError.badRequest('Request validation failed', details));
      return;
    }

    if (source === 'query') {
      // Express 5 made `req.query` a getter with no setter, so the Express 4
      // idiom `req.query = parsed` throws. Stash the parsed value on a
      // separate property instead; handlers read it via `getValidatedQuery`.
      validatedQuery.set(req, result.data);
    } else {
      req[source] = result.data as never;
    }

    next();
  };
}

/**
 * WeakMap rather than a property on `req` so the parsed value cannot be
 * spoofed by a crafted request body and is garbage-collected with the
 * request object.
 */
const validatedQuery = new WeakMap<Request, unknown>();

/**
 * Returns the query validated by `validate(schema, 'query')`.
 * Throws if called on a route that never ran query validation — that is a
 * programming error, not a client error, and should fail loudly in tests.
 */
export function getValidatedQuery<T>(req: Request): T {
  if (!validatedQuery.has(req)) {
    throw new Error(
      `getValidatedQuery called on ${req.method} ${req.path} without validate(schema, 'query')`,
    );
  }
  return validatedQuery.get(req) as T;
}
