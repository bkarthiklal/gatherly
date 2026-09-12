import type { ApiError, AuthResponse } from '@gatherly/types';

/**
 * A thin fetch wrapper that owns the access token.
 *
 * The access token lives only in memory — never localStorage, where any
 * injected script could read it. The refresh token is an httpOnly cookie the
 * page cannot see at all. On a 401 the client refreshes once (sharing a
 * single in-flight refresh between concurrent requests) and retries the
 * original request; if refresh fails the session is over.
 */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: { path: string; message: string }[];

  constructor(status: number, body: Partial<ApiError> | null) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.details = body?.error?.details ?? [];
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<AuthResponse | null> | null = null;
const sessionListeners = new Set<(session: AuthResponse | null) => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function onSessionChange(listener: (session: AuthResponse | null) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function setSession(session: AuthResponse | null): void {
  accessToken = session?.accessToken ?? null;
  sessionListeners.forEach((l) => l(session));
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') ?? '';
  return type.includes('application/json') ? res.json() : null;
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        setSession(null);
        return null;
      }
      const session = (await res.json()) as AuthResponse;
      setSession(session);
      return session;
    } catch {
      setSession(null);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Skip the automatic refresh-and-retry (used by the auth endpoints themselves). */
  noRetry?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '')
      url.searchParams.set(key, String(value));
  }
  return url.pathname + url.search;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let res = await send(path, options);

  if (res.status === 401 && !options.noRetry && accessToken !== null) {
    const refreshed = await refreshSession();
    if (refreshed) res = await send(path, options);
  }

  const body = await parseBody(res);
  if (!res.ok) throw new ApiRequestError(res.status, body as Partial<ApiError> | null);
  return body as T;
}

/** For binary downloads (ticket PDFs) that still need the bearer token. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  let res = await send(path, {});
  if (res.status === 401 && (await refreshSession())) res = await send(path, {});
  if (!res.ok)
    throw new ApiRequestError(res.status, (await parseBody(res)) as Partial<ApiError> | null);

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
