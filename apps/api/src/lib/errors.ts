import { ERROR_CODES, type ErrorCode } from '@gatherly/types';

/**
 * An error that is safe to show a client.
 *
 * The distinction matters: anything thrown as an `AppError` has a message
 * written for a user, whereas an unexpected `Error` may carry a stack, a
 * driver message, or a connection string. The error handler renders these
 * verbatim and everything else as a generic 500.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: { path: string; message: string }[];

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: { path: string; message: string }[]): AppError {
    return new AppError(400, ERROR_CODES.VALIDATION_FAILED, message, details);
  }

  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError(401, ERROR_CODES.UNAUTHENTICATED, message);
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError(403, ERROR_CODES.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, ERROR_CODES.NOT_FOUND, message);
  }

  static conflict(message: string): AppError {
    return new AppError(409, ERROR_CODES.CONFLICT, message);
  }

  static soldOut(message = 'Not enough tickets remaining'): AppError {
    return new AppError(409, ERROR_CODES.SOLD_OUT, message);
  }

  static holdExpired(message = 'Your reservation expired — please try again'): AppError {
    return new AppError(410, ERROR_CODES.HOLD_EXPIRED, message);
  }

  static ticketAlreadyUsed(message = 'This ticket has already been checked in'): AppError {
    return new AppError(409, ERROR_CODES.TICKET_ALREADY_USED, message);
  }

  static internal(message = 'Something went wrong'): AppError {
    return new AppError(500, ERROR_CODES.INTERNAL, message);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
