import type { UserRole } from '@gatherly/types';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../../lib/auth';
import { ButtonLink, EmptyState, Spinner } from '../ui';

/**
 * Client-side guards are for experience only — they decide what to render.
 * Every protected action is enforced again by the API, which is the only
 * place authorisation actually happens.
 */
export function RequireAuth({ children, roles }: { children: ReactNode; roles?: UserRole[] }) {
  const { user, loading, hasRole } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session" />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (roles && !hasRole(...roles)) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <EmptyState
          icon={<ShieldAlert className="size-10" />}
          title="You don't have access to this page"
          description={`This area is for ${roles.join(' or ')} accounts.`}
          action={<ButtonLink to="/">Go home</ButtonLink>}
        />
      </div>
    );
  }
  return children;
}
