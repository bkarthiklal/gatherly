import type { EventSummary } from '@gatherly/types';
import { MapPin } from 'lucide-react';
import { Link } from 'react-router';
import { CATEGORY_LABELS, dateBadge, formatMoney, formatTime } from '../../lib/format';
import { Badge } from '../ui';
import { EventCover } from './EventCover';

export function EventCard({ event }: { event: EventSummary }) {
  const badge = dateBadge(event.startsAt);
  return (
    <Link
      to={`/events/${event.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative aspect-[16/9] overflow-hidden">
        <EventCover
          bannerUrl={event.bannerUrl}
          category={event.category}
          title={event.title}
          className="transition group-hover:scale-[1.02]"
        />
        <div className="absolute left-3 top-3 rounded-lg bg-white/95 px-2.5 py-1 text-center shadow-sm">
          <div className="text-lg font-bold leading-none text-slate-900">{badge.day}</div>
          <div className="text-[10px] font-semibold tracking-wider text-brand-600">
            {badge.month}
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <Badge tone="brand">{CATEGORY_LABELS[event.category]}</Badge>
          {event.status === 'cancelled' && <Badge tone="red">Cancelled</Badge>}
        </div>
        <h3 className="line-clamp-2 font-semibold text-slate-900 group-hover:text-brand-700">
          {event.title}
        </h3>
        <p className="flex items-center gap-1 text-sm text-slate-500">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {event.venue.name}, {event.venue.city} · {formatTime(event.startsAt)}
          </span>
        </p>
        <p className="mt-auto pt-2 text-sm font-semibold text-slate-900">
          {event.fromPriceMinor === null ? (
            <span className="text-slate-500">Sold out</span>
          ) : event.fromPriceMinor === 0 ? (
            'Free'
          ) : (
            <>From {formatMoney(event.fromPriceMinor)}</>
          )}
        </p>
      </div>
    </Link>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
      <div className="aspect-[16/9] animate-pulse bg-slate-200" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-16 animate-pulse rounded bg-slate-200" />
        <div className="h-5 w-3/4 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200" />
      </div>
    </div>
  );
}
