import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button, ButtonLink } from '../components/ui';

const RELOAD_FLAG = 'gatherly:chunk-reload';

/**
 * A lazily loaded chunk fails to load mostly for one reason: a new version
 * was deployed while this tab was open, and the old hashed file names no
 * longer exist. Reloading fetches the new version. The session flag stops
 * a genuinely broken deploy from reloading forever.
 */
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

export function RouteError() {
  const error = useRouteError();
  const chunkError = isChunkLoadError(error);

  useEffect(() => {
    if (!chunkError) return;
    try {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        window.location.reload();
      }
    } catch {
      // Storage unavailable (private mode): fall through to the manual button.
    }
  }, [chunkError]);

  useEffect(() => {
    // A page that rendered without error clears the flag for next time.
    const t = setTimeout(() => {
      try {
        sessionStorage.removeItem(RELOAD_FLAG);
      } catch {
        /* ignore */
      }
    }, 10_000);
    return () => clearTimeout(t);
  }, []);

  const title = chunkError
    ? 'Gatherly has been updated'
    : isRouteErrorResponse(error) && error.status === 404
      ? 'Page not found'
      : 'Something went wrong';
  const body = chunkError
    ? 'Reload the page to get the latest version.'
    : 'An unexpected error stopped this page from loading. Reloading usually fixes it.';

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto size-10 text-amber-500" aria-hidden />
        <h1 className="mt-4 text-xl font-bold">{title}</h1>
        <p className="mt-2 text-slate-600">{body}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" aria-hidden /> Reload
          </Button>
          <ButtonLink to="/" variant="secondary" reloadDocument>
            Go home
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
