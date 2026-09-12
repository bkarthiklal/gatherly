import { EVENT_CATEGORIES } from '@gatherly/types';
import { useQuery } from '@tanstack/react-query';
import { QrCode, Search, ShieldCheck, Zap } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { EventCard, EventCardSkeleton } from '../components/events/EventCard';
import { Alert, ButtonLink } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { CATEGORY_LABELS } from '../lib/format';
import { eventsQuery } from '../lib/queries';

export function HomePage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, isPending, error } = useQuery(eventsQuery({ limit: 6 }));

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    void navigate(q.trim() ? `/events?q=${encodeURIComponent(q.trim())}` : '/events');
  };

  return (
    <>
      <section className="relative overflow-hidden bg-slate-900">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,var(--color-brand-600),transparent_60%)] opacity-60" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <h1 className="max-w-2xl text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Tickets for the events your city actually talks about.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-slate-300">
            Indie gigs, meetups, workshops and community days — sold fairly, with no scalpers and no
            surprise fees.
          </p>
          <form onSubmit={onSearch} className="mt-8 flex max-w-xl gap-2" role="search">
            <label htmlFor="home-search" className="sr-only">
              Search events
            </label>
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                id="home-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search concerts, conferences, workshops…"
                className="h-12 w-full rounded-lg border-0 bg-white pl-10 pr-3 text-slate-900 shadow-sm placeholder:text-slate-400 focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <button
              type="submit"
              className="h-12 rounded-lg bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600"
            >
              Search
            </button>
          </form>
          <div className="mt-6 flex flex-wrap gap-2">
            {EVENT_CATEGORIES.filter((c) => c !== 'other').map((c) => (
              <Link
                key={c}
                to={`/events?category=${c}`}
                className="rounded-full bg-white/10 px-3 py-1 text-sm text-white ring-1 ring-white/20 hover:bg-white/20"
              >
                {CATEGORY_LABELS[c]}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="mb-6 flex items-end justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Coming up</h2>
          <Link to="/events" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            See all events →
          </Link>
        </div>
        {error ? (
          <Alert title="Couldn't load events">{errorMessage(error)}</Alert>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {isPending
              ? Array.from({ length: 6 }, (_, i) => <EventCardSkeleton key={i} />)
              : data.items.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
        )}
      </section>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-3">
          {[
            {
              icon: <Zap className="size-5" />,
              title: 'Never oversold',
              body: 'Seats are reserved atomically while you check out. If it says available, it is.',
            },
            {
              icon: <ShieldCheck className="size-5" />,
              title: 'No scalping',
              body: 'Per-person limits and signed, single-use tickets keep prices fair for real fans.',
            },
            {
              icon: <QrCode className="size-5" />,
              title: 'Paperless entry',
              body: 'Your ticket is a QR code on your phone. One scan at the door, and you are in.',
            },
          ].map((f) => (
            <div key={f.title}>
              <div className="mb-3 grid size-10 place-items-center rounded-lg bg-brand-50 text-brand-600">
                {f.icon}
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-4 rounded-2xl bg-brand-50 p-8 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-lg font-semibold text-brand-900">Running an event?</h3>
              <p className="text-sm text-brand-900/80">
                Create an organiser account and start selling in minutes. No platform fee.
              </p>
            </div>
            <ButtonLink to="/register?role=organiser">Start selling</ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
