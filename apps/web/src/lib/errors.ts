import { ApiRequestError } from './api';

/** A message fit to show a person, whatever was thrown. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong. Please try again.';
}

/** Maps API validation details onto react-hook-form field names. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiRequestError)) return {};
  return Object.fromEntries(err.details.map((d) => [d.path, d.message]));
}
