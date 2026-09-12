import { EVENT_CATEGORIES, type EventCategory } from '@gatherly/types';
import { useQuery } from '@tanstack/react-query';
import { CalendarX, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EventCard, EventCardSkeleton } from '../components/events/EventCard';
import { Page } from '../components/layout/Page';
import { Alert, Button, EmptyState, Input, PageHeader } from '../components/ui';
import { cn } from '../lib/cn';
import { errorMessage } from '../lib/errors';
import { CATEGORY_LABELS } from '../lib/format';
import { eventsQuery } from '../lib/queries';

const PAGE_SIZE = 12;

export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = (params.get('category') as EventCategory | null) ?? undefined;
  const city = params.get('city') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1));

  const [search, setSearch] = useState(q);
  const [cityInput, setCityInput] = useState(city);

  const update = (next: Record<string, string | undefined>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) merged.set(k, v);
      else merged.delete(k);
    }
    if (!('page' in next)) merged.delete('page');
    setParams(merged, { replace: true });
  };

  // Debounce typing so every keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => {
      const nextQ = search.trim();
      const nextCity = cityInput.trim();
      if (nextQ !== q || nextCity !== city)
        update({ q: nextQ || undefined, city: nextCity || undefined });
    }, 300);
    return () => clearTimeout(t);
    // Only typing should trigger this; URL-driven changes flow the other way.
  }, [search, cityInput]);

  const { data, isPending, isFetching, error } = useQuery(
    eventsQuery({ q: q || undefined, category, city: city || undefined, page, limit: PAGE_SIZE }),
  );

  return (
    <Page>
      <PageHeader title="Browse events" description="Upcoming events, soonest first." />

      <div className="mb-6 grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <label htmlFor="q" className="sr-only">
            Search
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            id="q"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or description"
            className="pl-9"
          />
        </div>
        <div>
          <label htmlFor="city" className="sr-only">
            City
          </label>
          <Input
            id="city"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            placeholder="City (e.g. Bengaluru)"
          />
        </div>
      </div>

      <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="Category">
        {[undefined, ...EVENT_CATEGORIES].map((c) => (
          <button
            key={c ?? 'all'}
            type="button"
            aria-pressed={category === c}
            onClick={() => update({ category: c })}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition',
              category === c
                ? 'bg-brand-600 text-white ring-brand-600'
                : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50',
            )}
          >
            {c ? CATEGORY_LABELS[c] : 'All'}
          </button>
        ))}
      </div>

      {error ? (
        <Alert title="Couldn't load events">{errorMessage(error)}</Alert>
      ) : isPending ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={<CalendarX className="size-10" />}
          title="No events match"
          description="Try a different search, another city, or clear the category filter."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('');
                setCityInput('');
                setParams({});
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-500" aria-live="polite">
            {data.total} event{data.total === 1 ? '' : 's'}
            {isFetching && ' · updating…'}
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
          {data.totalPages > 1 && (
            <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Pagination">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
              >
                Previous
              </Button>
              <span className="text-sm text-slate-600">
                Page {data.page} of {data.totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={page >= data.totalPages}
                onClick={() => update({ page: String(page + 1) })}
              >
                Next
              </Button>
            </nav>
          )}
        </>
      )}
    </Page>
  );
}
