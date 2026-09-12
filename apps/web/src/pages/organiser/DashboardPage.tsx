import type { OrganiserOverview } from '@gatherly/types';
import { useQuery } from '@tanstack/react-query';
import { CalendarPlus, ScanLine } from 'lucide-react';
import { Link } from 'react-router';
import { RequireAuth } from '../../components/layout/guards';
import { Page } from '../../components/layout/Page';
import { EventStatusBadge } from '../../components/organiser/StatusBadge';
import {
  Alert,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  Stat,
} from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { formatAmount, formatDateTime } from '../../lib/format';
import { organiserEventsQuery } from '../../lib/queries';

function Dashboard() {
  const overview = useQuery({
    queryKey: ['organiser', 'overview'],
    queryFn: ({ signal }) => api<OrganiserOverview>('/organiser/overview', { signal }),
  });
  const events = useQuery(organiserEventsQuery);

  if (overview.isPending || events.isPending) return <Spinner label="Loading your dashboard" />;
  if (overview.error || events.error) {
    return (
      <Alert title="Couldn't load your dashboard">
        {errorMessage(overview.error ?? events.error)}
      </Alert>
    );
  }

  const o = overview.data;
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={formatAmount(o.revenueMinor)}
          sub="Paid orders, after discounts"
        />
        <Stat label="Tickets sold" value={o.ticketsSold.toLocaleString('en-IN')} />
        <Stat label="Events" value={o.events} sub={`${o.published} published`} />
        <Stat label="Upcoming" value={o.upcoming.length} sub="Published and not yet started" />
      </div>

      {events.data.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus className="size-10" />}
          title="Create your first event"
          description="Add details and ticket types, then submit it for a quick review before it goes live."
          action={<ButtonLink to="/organiser/events/new">Create event</ButtonLink>}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Event</th>
                <th className="px-5 py-3 font-medium">Starts</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Sold</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.data.map((e) => {
                const sold = e.tiers.reduce((n, t) => n + t.quantitySold, 0);
                const capacity = e.tiers.reduce((n, t) => n + t.quantityTotal, 0);
                const pct = capacity ? Math.round((sold / capacity) * 100) : 0;
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link
                        to={`/organiser/events/${e.id}`}
                        className="font-medium hover:text-brand-700"
                      >
                        {e.title}
                      </Link>
                      <p className="text-xs text-slate-500">{e.venue.city}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{formatDateTime(e.startsAt)}</td>
                    <td className="px-5 py-3">
                      <EventStatusBadge status={e.status} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-slate-600">
                          {sold}/{capacity}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {e.status === 'published' && (
                          <ButtonLink
                            to={`/organiser/events/${e.id}/check-in`}
                            variant="ghost"
                            size="sm"
                          >
                            <ScanLine className="size-4" aria-hidden /> Check-in
                          </ButtonLink>
                        )}
                        <ButtonLink to={`/organiser/events/${e.id}`} variant="secondary" size="sm">
                          Manage
                        </ButtonLink>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export function DashboardPage() {
  return (
    <RequireAuth roles={['organiser', 'admin']}>
      <Page>
        <PageHeader
          title="Organiser dashboard"
          actions={
            <ButtonLink to="/organiser/events/new">
              <CalendarPlus className="size-4" aria-hidden /> New event
            </ButtonLink>
          }
        />
        <Dashboard />
      </Page>
    </RequireAuth>
  );
}
