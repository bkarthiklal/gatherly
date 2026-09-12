import { LogOut, Menu, Ticket, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { ButtonLink } from '../ui';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-bold tracking-tight text-slate-900">
      <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
        <Ticket className="size-4.5" aria-hidden />
      </span>
      Gatherly
    </Link>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-50 text-brand-700'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  );

export function AppLayout() {
  const { user, hasRole, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const links = [
    { to: '/events', label: 'Browse events', show: true },
    { to: '/tickets', label: 'My tickets', show: !!user },
    { to: '/organiser', label: 'Organiser', show: hasRole('organiser', 'admin') },
    { to: '/admin', label: 'Admin', show: hasRole('admin') },
  ].filter((l) => l.show);

  const onLogout = async () => {
    setOpen(false);
    await logout();
    await navigate('/');
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} className={navClass}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            {user ? (
              <>
                <span className="text-sm text-slate-600">
                  {user.name}
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs capitalize text-slate-600">
                    {user.role}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void onLogout()}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  <LogOut className="size-4" aria-hidden /> Sign out
                </button>
              </>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost">
                  Sign in
                </ButtonLink>
                <ButtonLink to="/register">Create account</ButtonLink>
              </>
            )}
          </div>

          <button
            type="button"
            className="rounded-lg p-2 text-slate-600 md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {open && (
          <nav
            className="border-t border-slate-200 bg-white px-4 py-3 md:hidden"
            aria-label="Mobile"
          >
            <div className="flex flex-col gap-1">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} className={navClass} onClick={() => setOpen(false)}>
                  {l.label}
                </NavLink>
              ))}
              <div className="mt-2 border-t border-slate-100 pt-2">
                {user ? (
                  <button
                    type="button"
                    onClick={() => void onLogout()}
                    className={navClass({ isActive: false })}
                  >
                    Sign out ({user.name})
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <ButtonLink
                      to="/login"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setOpen(false)}
                    >
                      Sign in
                    </ButtonLink>
                    <ButtonLink to="/register" className="flex-1" onClick={() => setOpen(false)}>
                      Create account
                    </ButtonLink>
                  </div>
                )}
              </div>
            </div>
          </nav>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} Gatherly — fair tickets for independent events.</p>
          <p>Payments by Razorpay. Card details never touch our servers.</p>
        </div>
      </footer>
    </div>
  );
}
