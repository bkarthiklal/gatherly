import type { Ticket } from '@gatherly/types';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Ticket as TicketIcon } from 'lucide-react';
import { Link } from 'react-router';
import { RequireAuth } from '../components/layout/guards';
import { Page } from '../components/layout/Page';
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { dateBadge, formatDateLong, formatMoneyExact, formatTime } from '../lib/format';
import { ordersQuery, ticketsQuery } from '../lib/queries';

const STATUS_TONE = { valid: 'green', used: 'slate', refunded: 'amber', void: 'red' } as const;

function groupByEvent(tickets: Ticket[]) {
  const groups = new Map<string, Ticket[]>();
  for (const t of tickets) groups.set(t.eventId, [...(groups.get(t.eventId) ?? []), t]);
  return [...groups.values()].sort((a, b) => a[0]!.startsAt.localeCompare(b[0]!.startsAt));
}

function MyTickets() {
  const { data: tickets, isPending, error } = useQuery(ticketsQuery);
  const { data: orders } = useQuery(ordersQuery);

  if (isPending) return <Spinner label="Loading tickets" />;
  if (error) return <Alert title="Couldn't load tickets">{errorMessage(error)}</Alert>;

  const now = new Date().toISOString();
  const groups = groupByEvent(tickets);
  const upcoming = groups.filter((g) => g[0]!.endsAt >= now);
  const past = groups.filter((g) => g[0]!.endsAt < now);

  const renderGroup = (group: Ticket[]) => {
    const first = group[0]!;
    const badge = dateBadge(first.startsAt);
    return (
      <Card key={first.eventId} className="overflow-hidden">
        <div className="flex gap-4 border-b border-slate-100 p-5">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg bg-brand-50 text-center">
            <div>
              <div className="text-lg font-bold leading-none text-brand-700">{badge.day}</div>
              <div className="text-[10px] font-semibold tracking-wider text-brand-600">
                {badge.month}
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <Link to={`/events/${first.eventSlug}`} className="font-semibold hover:text-brand-700">
              {first.eventTitle}
            </Link>
            <p className="text-sm text-slate-600">
              {formatDateLong(first.startsAt)} · {formatTime(first.startsAt)}
            </p>
            <p className="truncate text-sm text-slate-500">
              {first.venue.name}, {first.venue.city}
            </p>
          </div>
        </div>
        <ul className="divide-y divide-slate-100">
          {group.map((t) => (
            <li key={t.id}>
              <Link
                to={`/tickets/${t.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-slate-50"
              >
                <div>
                  <p className="text-sm font-medium">{t.tierName}</p>
                  <p className="font-mono text-xs text-slate-500">{t.serial}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[t.status]}>
                    {t.status === 'used' ? 'checked in' : t.status}
                  </Badge>
                  <ChevronRight className="size-4 text-slate-400" aria-hidden />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    );
  };

  return (
    <div className="space-y-10">
      {tickets.length === 0 ? (
        <EmptyState
          icon={<TicketIcon className="size-10" />}
          title="No tickets yet"
          description="When you buy tickets they'll appear here, ready to show at the door."
          action={<ButtonLink to="/events">Find an event</ButtonLink>}
        />
      ) : (
        <>
          <section>
            <h2 className="mb-4 text-lg font-semibold">Upcoming</h2>
            {upcoming.length ? (
              <div className="grid gap-4 md:grid-cols-2">{upcoming.map(renderGroup)}</div>
            ) : (
              <p className="text-sm text-slate-500">Nothing coming up.</p>
            )}
          </section>
          {past.length > 0 && (
            <section>
              <h2 className="mb-4 text-lg font-semibold text-slate-600">Past</h2>
              <div className="grid gap-4 opacity-80 md:grid-cols-2">{past.map(renderGroup)}</div>
            </section>
          )}
        </>
      )}

      {orders && orders.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Order history</h2>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-slate-200 text-left text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Event</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium">Total</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link to={`/orders/${o.id}`} className="font-medium hover:text-brand-700">
                        {o.eventTitle}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{formatDateLong(o.createdAt)}</td>
                    <td className="px-5 py-3 tabular-nums">{formatMoneyExact(o.totalMinor)}</td>
                    <td className="px-5 py-3">
                      <Badge
                        tone={
                          o.status === 'paid' ? 'green' : o.status === 'pending' ? 'amber' : 'slate'
                        }
                      >
                        {o.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </div>
  );
}

export function TicketsPage() {
  return (
    <RequireAuth>
      <Page>
        <PageHeader title="My tickets" />
        <MyTickets />
      </Page>
    </RequireAuth>
  );
}
