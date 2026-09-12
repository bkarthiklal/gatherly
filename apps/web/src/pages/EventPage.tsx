import type { EventDetail, Hold, TicketTier } from '@gatherly/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Clock, MapPin, Minus, Plus, Radio, User } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { EventCover } from '../components/events/EventCover';
import { Page } from '../components/layout/Page';
import { Alert, Badge, Button, ButtonLink, Card, EmptyState, Spinner } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/errors';
import { CATEGORY_LABELS, formatDateLong, formatMoney, formatTime } from '../lib/format';
import { useLiveAvailability } from '../lib/live';
import { eventQuery, keys } from '../lib/queries';

function TierRow({
  tier,
  quantity,
  onChange,
}: {
  tier: TicketTier;
  quantity: number;
  onChange: (q: number) => void;
}) {
  const max = Math.min(tier.perUserLimit, tier.quantityAvailable);
  const low = tier.onSale && tier.quantityAvailable > 0 && tier.quantityAvailable <= 10;
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{tier.name}</p>
        <p className="text-sm text-slate-600">{formatMoney(tier.priceMinor)}</p>
        <p className="mt-0.5 text-xs text-slate-500" aria-live="polite">
          {!tier.onSale ? (
            tier.quantityAvailable === 0 ? (
              <span className="font-medium text-red-600">Sold out</span>
            ) : (
              'Not on sale right now'
            )
          ) : low ? (
            <span className="font-medium text-amber-700">Only {tier.quantityAvailable} left</span>
          ) : (
            `${tier.quantityAvailable} available · max ${tier.perUserLimit} per person`
          )}
        </p>
      </div>
      {tier.onSale && max > 0 && (
        <div
          className="flex items-center gap-2"
          role="group"
          aria-label={`Quantity for ${tier.name}`}
        >
          <button
            type="button"
            onClick={() => onChange(Math.max(0, quantity - 1))}
            disabled={quantity === 0}
            className="grid size-9 place-items-center rounded-lg ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40"
            aria-label={`Remove one ${tier.name}`}
          >
            <Minus className="size-4" />
          </button>
          <span className="w-6 text-center font-semibold tabular-nums" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => onChange(Math.min(max, quantity + 1))}
            disabled={quantity >= max}
            className="grid size-9 place-items-center rounded-lg ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-40"
            aria-label={`Add one ${tier.name}`}
          >
            <Plus className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function TicketPanel({ event }: { event: EventDetail }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [reserving, setReserving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useLiveAvailability(event);

  const chosen = event.tiers.filter((t) => (selection[t.id] ?? 0) > 0);
  const total = chosen.reduce((sum, t) => sum + t.priceMinor * (selection[t.id] ?? 0), 0);
  const seats = chosen.reduce((n, t) => n + (selection[t.id] ?? 0), 0);

  const reserve = async () => {
    if (!user) {
      await navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
      return;
    }
    setReserving(true);
    setError(null);
    const created: Hold[] = [];
    try {
      for (const tier of chosen) {
        created.push(
          await api<Hold>('/holds', {
            method: 'POST',
            body: { tierId: tier.id, quantity: selection[tier.id] },
          }),
        );
      }
      await queryClient.invalidateQueries({ queryKey: keys.holds });
      await navigate(`/checkout?holds=${created.map((h) => h.id).join(',')}`);
    } catch (err) {
      // All or nothing: give back anything reserved before the failure.
      await Promise.all(
        created.map((h) => api(`/holds/${h.id}`, { method: 'DELETE' }).catch(() => undefined)),
      );
      setError(
        err instanceof ApiRequestError && err.code === 'SOLD_OUT'
          ? 'Someone just took the last of those seats. Please adjust your selection.'
          : errorMessage(err),
      );
      await queryClient.invalidateQueries({ queryKey: keys.event(event.slug) });
    } finally {
      setReserving(false);
    }
  };

  if (event.status === 'cancelled') {
    return (
      <Card className="p-6">
        <Alert tone="red" title="This event has been cancelled">
          Everyone who bought a ticket is being refunded automatically to their original payment
          method.
        </Alert>
      </Card>
    );
  }

  if (new Date(event.startsAt) <= new Date()) {
    return (
      <Card className="p-6">
        <Alert tone="amber" title="Ticket sales have closed">
          This event has already started.
        </Alert>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tickets</h2>
        {live && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <Radio className="size-3.5" aria-hidden /> Live availability
          </span>
        )}
      </div>
      <div className="divide-y divide-slate-100">
        {event.tiers.map((tier) => (
          <TierRow
            key={tier.id}
            tier={tier}
            quantity={Math.min(
              selection[tier.id] ?? 0,
              Math.min(tier.perUserLimit, tier.quantityAvailable),
            )}
            onChange={(q) => setSelection((s) => ({ ...s, [tier.id]: q }))}
          />
        ))}
      </div>

      {error && (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      )}

      <div className="mt-4 border-t border-slate-200 pt-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-sm text-slate-600">
            {seats > 0 ? `${seats} ticket${seats === 1 ? '' : 's'}` : 'Select tickets'}
          </span>
          <span className="text-xl font-bold">{seats > 0 ? formatMoney(total) : '—'}</span>
        </div>
        <Button
          size="lg"
          className="w-full"
          disabled={seats === 0}
          loading={reserving}
          onClick={() => void reserve()}
        >
          {user ? 'Reserve and check out' : 'Sign in to buy'}
        </Button>
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Clock className="size-3.5" aria-hidden /> Seats are held for 8 minutes while you pay.
        </p>
      </div>
    </Card>
  );
}

export function EventPage() {
  const { slug = '' } = useParams();
  const { data: event, isPending, error } = useQuery(eventQuery(slug));

  if (isPending) return <Spinner label="Loading event" />;
  if (error) {
    return (
      <Page>
        {error instanceof ApiRequestError && error.status === 404 ? (
          <EmptyState
            icon={<AlertTriangle className="size-10" />}
            title="Event not found"
            description="It may have been removed, or the link is wrong."
            action={<ButtonLink to="/events">Browse events</ButtonLink>}
          />
        ) : (
          <Alert title="Couldn't load this event">{errorMessage(error)}</Alert>
        )}
      </Page>
    );
  }

  const mapUrl = event.venue.coordinates
    ? `https://www.google.com/maps/search/?api=1&query=${event.venue.coordinates[1]},${event.venue.coordinates[0]}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${event.venue.name} ${event.venue.addressLine} ${event.venue.city}`)}`;

  return (
    <>
      <div className="h-56 w-full overflow-hidden sm:h-72">
        <EventCover
          bannerUrl={event.bannerUrl}
          category={event.category}
          title={event.title}
          showTitle={false}
        />
      </div>
      <Page className="pt-0 sm:pt-0">
        <div className="-mt-10 grid gap-8 lg:grid-cols-[1fr_380px]">
          <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge tone="brand">{CATEGORY_LABELS[event.category]}</Badge>
              {event.status === 'cancelled' && <Badge tone="red">Cancelled</Badge>}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">{event.title}</h1>

            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="flex gap-3">
                <CalendarDays className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                <div>
                  <dt className="sr-only">Date and time</dt>
                  <dd className="font-medium">{formatDateLong(event.startsAt)}</dd>
                  <dd className="text-sm text-slate-600">
                    {formatTime(event.startsAt)} – {formatTime(event.endsAt)} IST
                  </dd>
                </div>
              </div>
              <div className="flex gap-3">
                <MapPin className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                <div>
                  <dt className="sr-only">Venue</dt>
                  <dd className="font-medium">{event.venue.name}</dd>
                  <dd className="text-sm text-slate-600">
                    {event.venue.addressLine}, {event.venue.city} ·{' '}
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-600 hover:underline"
                    >
                      Map
                    </a>
                  </dd>
                </div>
              </div>
              <div className="flex gap-3">
                <User className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden />
                <div>
                  <dt className="sr-only">Organiser</dt>
                  <dd className="font-medium">{event.organiser.name}</dd>
                  <dd className="text-sm text-slate-600">Organiser</dd>
                </div>
              </div>
            </dl>

            <div className="mt-8 border-t border-slate-100 pt-6">
              <h2 className="mb-3 text-lg font-semibold">About this event</h2>
              <p className="whitespace-pre-line leading-relaxed text-slate-700">
                {event.description}
              </p>
            </div>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <TicketPanel event={event} />
            <p className="mt-4 text-center text-sm text-slate-500">
              <Link to="/events" className="hover:text-slate-700">
                ← More events
              </Link>
            </p>
          </div>
        </div>
      </Page>
    </>
  );
}
