import type {
  EventAnalytics,
  OrganiserEvent,
  OrganiserOrder,
  PromoCode,
  TicketTier,
} from '@gatherly/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ExternalLink,
  Pencil,
  Plus,
  ScanLine,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { RequireAuth } from '../../components/layout/guards';
import { Page } from '../../components/layout/Page';
import { EventStatusBadge } from '../../components/organiser/StatusBadge';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Stat,
  Textarea,
} from '../../components/ui';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatAmount, formatDateTime, formatMoney, formatMoneyExact } from '../../lib/format';
import { keys, organiserEventQuery } from '../../lib/queries';

const SalesChart = lazy(() => import('../../components/organiser/SalesChart'));

type Tab = 'overview' | 'tickets' | 'promos' | 'orders';

// ─── Overview ───────────────────────────────────────────────────────────────

function Overview({ event }: { event: OrganiserEvent }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['organiser', 'analytics', event.id],
    queryFn: ({ signal }) =>
      api<EventAnalytics>(`/organiser/events/${event.id}/analytics`, { signal }),
  });
  if (isPending) return <Spinner label="Crunching numbers" />;
  if (error) return <Alert>{errorMessage(error)}</Alert>;

  const sellThrough = data.capacity ? Math.round((data.ticketsSold / data.capacity) * 100) : 0;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Revenue"
          value={formatAmount(data.revenueMinor)}
          sub={data.refundedMinor ? `${formatAmount(data.refundedMinor)} refunded` : 'No refunds'}
        />
        <Stat
          label="Tickets sold"
          value={`${data.ticketsSold} / ${data.capacity}`}
          sub={`${sellThrough}% sell-through`}
        />
        <Stat label="Paid orders" value={data.ordersPaid} />
        <Stat
          label="Checked in"
          value={data.checkedIn}
          sub={
            data.ticketsSold
              ? `${Math.round((data.checkedIn / data.ticketsSold) * 100)}% of sold`
              : undefined
          }
        />
      </div>

      <Card className="p-6">
        <h3 className="mb-4 font-semibold">Sales by day</h3>
        {data.salesByDay.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">No sales yet.</p>
        ) : (
          <Suspense fallback={<Spinner label="Loading chart" />}>
            <SalesChart data={data.salesByDay} />
          </Suspense>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="mb-4 font-semibold">By ticket type</h3>
          <ul className="space-y-4">
            {data.tiers.map((t) => {
              const pct = t.capacity ? (t.sold / t.capacity) * 100 : 0;
              const heldPct = t.capacity ? (t.held / t.capacity) * 100 : 0;
              return (
                <li key={t.tierId}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{t.name}</span>
                    <span className="tabular-nums text-slate-600">
                      {t.sold}/{t.capacity} · {formatAmount(t.revenueMinor)}
                    </span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="bg-brand-500" style={{ width: `${pct}%` }} />
                    <div
                      className="bg-amber-400"
                      style={{ width: `${heldPct}%` }}
                      title={`${t.held} on hold`}
                    />
                  </div>
                  {t.held > 0 && (
                    <p className="mt-1 text-xs text-amber-700">
                      {t.held} in someone's checkout right now
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card className="p-6">
          <h3 className="mb-4 font-semibold">Promo code usage</h3>
          {data.promoCodes.length === 0 ? (
            <p className="text-sm text-slate-500">No codes used yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {data.promoCodes.map((p) => (
                <li key={p.code} className="flex justify-between py-2">
                  <span className="font-mono">{p.code}</span>
                  <span className="text-slate-600">
                    {p.uses} use{p.uses === 1 ? '' : 's'} · {formatAmount(p.discountMinor)} off
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Ticket types ───────────────────────────────────────────────────────────

function TierEditor({
  event,
  tier,
  onClose,
}: {
  event: OrganiserEvent;
  tier: TicketTier | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: tier?.name ?? '',
    price: tier ? String(tier.priceMinor / 100) : '',
    quantityTotal: tier ? String(tier.quantityTotal) : '',
    perUserLimit: tier ? String(tier.perUserLimit) : '4',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        priceMinor: Math.round(Number(form.price) * 100),
        quantityTotal: Number(form.quantityTotal),
        perUserLimit: Number(form.perUserLimit),
      };
      return tier
        ? api(`/organiser/events/${event.id}/tiers/${tier.id}`, { method: 'PATCH', body })
        : api(`/organiser/events/${event.id}/tiers`, {
            method: 'POST',
            body: { ...body, currency: 'INR' },
          });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.organiserEvent(event.id) });
      onClose();
    },
  });

  return (
    <Modal open title={tier ? `Edit ${tier.name}` : 'Add ticket type'} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label="Name">
          {(p) => (
            <Input
              {...p}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          )}
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Price (₹)">
            {(p) => (
              <Input
                {...p}
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
              />
            )}
          </Field>
          <Field label="Capacity">
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={form.quantityTotal}
                onChange={(e) => setForm({ ...form, quantityTotal: e.target.value })}
                required
              />
            )}
          </Field>
          <Field label="Max/person">
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={form.perUserLimit}
                onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
                required
              />
            )}
          </Field>
        </div>
        {tier && tier.quantitySold + tier.quantityHeld > 0 && (
          <p className="text-xs text-slate-500">
            Capacity can't go below {tier.quantitySold + tier.quantityHeld} (already sold or in
            checkout).
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Tickets({ event }: { event: OrganiserEvent }) {
  const [editing, setEditing] = useState<TicketTier | null | 'new'>(null);
  const locked = event.status === 'cancelled';
  return (
    <Card className="overflow-x-auto">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <h3 className="font-semibold">Ticket types</h3>
        <Button
          size="sm"
          variant="secondary"
          disabled={locked || event.tiers.length >= 10}
          onClick={() => setEditing('new')}
        >
          <Plus className="size-4" aria-hidden /> Add type
        </Button>
      </div>
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="px-5 py-3 font-medium">Name</th>
            <th className="px-5 py-3 font-medium">Price</th>
            <th className="px-5 py-3 font-medium">Sold</th>
            <th className="px-5 py-3 font-medium">In checkout</th>
            <th className="px-5 py-3 font-medium">Available</th>
            <th className="px-5 py-3 font-medium">Limit</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {event.tiers.map((t) => (
            <tr key={t.id}>
              <td className="px-5 py-3 font-medium">{t.name}</td>
              <td className="px-5 py-3">{formatMoney(t.priceMinor)}</td>
              <td className="px-5 py-3 tabular-nums">
                {t.quantitySold} / {t.quantityTotal}
              </td>
              <td className="px-5 py-3 tabular-nums">{t.quantityHeld}</td>
              <td className="px-5 py-3 tabular-nums">{t.quantityAvailable}</td>
              <td className="px-5 py-3 tabular-nums">{t.perUserLimit}</td>
              <td className="px-5 py-3 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked}
                  onClick={() => setEditing(t)}
                  aria-label={`Edit ${t.name}`}
                >
                  <Pencil className="size-4" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <TierEditor
          event={event}
          tier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

// ─── Promo codes ────────────────────────────────────────────────────────────

function Promos({ event }: { event: OrganiserEvent }) {
  const queryClient = useQueryClient();
  const queryKey = ['organiser', 'promos', event.id];
  const { data, isPending, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      api<{ items: PromoCode[] }>(`/organiser/events/${event.id}/promo-codes`, { signal }).then(
        (r) => r.items,
      ),
  });
  const [form, setForm] = useState({ code: '', type: 'percent', value: '', maxUses: '' });

  const create = useMutation({
    mutationFn: () =>
      api(`/organiser/events/${event.id}/promo-codes`, {
        method: 'POST',
        body: {
          code: form.code,
          type: form.type,
          value:
            form.type === 'percent' ? Number(form.value) : Math.round(Number(form.value) * 100),
          maxUses: form.maxUses ? Number(form.maxUses) : null,
        },
      }),
    onSuccess: async () => {
      setForm({ code: '', type: 'percent', value: '', maxUses: '' });
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const toggle = useMutation({
    mutationFn: (p: PromoCode) =>
      api(`/organiser/events/${event.id}/promo-codes/${p.id}`, {
        method: 'PATCH',
        body: { active: !p.active },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-x-auto">
        {isPending ? (
          <Spinner />
        ) : error ? (
          <div className="p-5">
            <Alert>{errorMessage(error)}</Alert>
          </div>
        ) : data.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500">No promo codes yet.</p>
        ) : (
          <table className="w-full min-w-[480px] text-sm">
            <thead className="border-b border-slate-200 text-left text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Discount</th>
                <th className="px-5 py-3 font-medium">Used</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3 font-mono font-medium">{p.code}</td>
                  <td className="px-5 py-3">
                    {p.type === 'percent' ? `${p.value}%` : formatAmount(p.value)}
                  </td>
                  <td className="px-5 py-3 tabular-nums">
                    {p.usedCount}
                    {p.maxUses !== null && ` / ${p.maxUses}`}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => toggle.mutate(p)}
                      className="rounded-full focus-visible:outline-2"
                      aria-label={`${p.active ? 'Deactivate' : 'Activate'} ${p.code}`}
                    >
                      <Badge tone={p.active ? 'green' : 'slate'}>
                        {p.active ? 'Active' : 'Off'}
                      </Badge>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card className="p-5">
        <h3 className="mb-4 font-semibold">New promo code</h3>
        <form onSubmit={onSubmit} className="space-y-3">
          {create.error && <Alert>{errorMessage(create.error)}</Alert>}
          <Field label="Code">
            {(p) => (
              <Input
                {...p}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="EARLYBIRD"
                required
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              {(p) => (
                <Select
                  {...p}
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="percent">Percent</option>
                  <option value="fixed">Fixed ₹</option>
                </Select>
              )}
            </Field>
            <Field label={form.type === 'percent' ? 'Percent off' : 'Rupees off'}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  required
                />
              )}
            </Field>
          </div>
          <Field label="Max uses" hint="Leave empty for unlimited">
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={form.maxUses}
                onChange={(e) => setForm({ ...form, maxUses: e.target.value })}
              />
            )}
          </Field>
          <Button
            type="submit"
            className="w-full"
            loading={create.isPending}
            disabled={event.status === 'cancelled'}
          >
            Create code
          </Button>
        </form>
      </Card>
    </div>
  );
}

// ─── Orders ─────────────────────────────────────────────────────────────────

function Orders({ event }: { event: OrganiserEvent }) {
  const queryClient = useQueryClient();
  const queryKey = ['organiser', 'orders', event.id];
  const { data, isPending, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      api<{ items: OrganiserOrder[] }>(`/organiser/events/${event.id}/orders`, { signal }).then(
        (r) => r.items,
      ),
  });
  const [refunding, setRefunding] = useState<OrganiserOrder | null>(null);
  const [reason, setReason] = useState('');

  const refund = useMutation({
    mutationFn: (order: OrganiserOrder) =>
      api(`/organiser/events/${event.id}/orders/${order.id}/refund`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: async () => {
      setRefunding(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  if (isPending) return <Spinner label="Loading orders" />;
  if (error) return <Alert>{errorMessage(error)}</Alert>;

  return (
    <Card className="overflow-x-auto">
      {data.length === 0 ? (
        <p className="p-10 text-center text-sm text-slate-500">No paid orders yet.</p>
      ) : (
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Buyer</th>
              <th className="px-5 py-3 font-medium">Seats</th>
              <th className="px-5 py-3 font-medium">Total</th>
              <th className="px-5 py-3 font-medium">Paid</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((o) => (
              <tr key={o.id}>
                <td className="px-5 py-3">
                  <p className="font-medium">{o.buyer.name}</p>
                  <p className="text-xs text-slate-500">{o.buyer.email}</p>
                </td>
                <td className="px-5 py-3 tabular-nums">{o.seats}</td>
                <td className="px-5 py-3 tabular-nums">
                  {formatMoneyExact(o.totalMinor)}
                  {o.promoCode && (
                    <span className="ml-1 font-mono text-xs text-slate-500">{o.promoCode}</span>
                  )}
                </td>
                <td className="px-5 py-3 text-slate-600">
                  {o.paidAt ? formatDateTime(o.paidAt) : '—'}
                </td>
                <td className="px-5 py-3">
                  {o.refund ? (
                    <Badge tone="amber">Refund {o.refund.status}</Badge>
                  ) : (
                    <Badge tone={o.status === 'paid' ? 'green' : 'slate'}>{o.status}</Badge>
                  )}
                </td>
                <td className="px-5 py-3 text-right">
                  {o.status === 'paid' && !o.refund && (
                    <Button size="sm" variant="ghost" onClick={() => setRefunding(o)}>
                      Refund
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal open={!!refunding} title="Refund this order?" onClose={() => setRefunding(null)}>
        {refunding && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              refund.mutate(refunding);
            }}
          >
            <p className="text-sm text-slate-600">
              {formatMoneyExact(refunding.totalMinor)} goes back to {refunding.buyer.name}'s
              original payment method. Their {refunding.seats} ticket
              {refunding.seats === 1 ? '' : 's'} stop working immediately and the seats go back on
              sale.
            </p>
            {refund.error && <Alert>{errorMessage(refund.error)}</Alert>}
            <Field label="Reason">
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  minLength={3}
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRefunding(null)}>
                Keep order
              </Button>
              <Button type="submit" variant="danger" loading={refund.isPending}>
                Refund
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

function Manage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: event, isPending, error } = useQuery(organiserEventQuery(eventId));
  const [tab, setTab] = useState<Tab>('overview');
  const [confirmCancel, setConfirmCancel] = useState(false);

  const action = useMutation({
    mutationFn: (kind: 'submit' | 'cancel' | 'delete') =>
      kind === 'delete'
        ? api(`/organiser/events/${eventId}`, { method: 'DELETE' })
        : api(`/organiser/events/${eventId}/${kind}`, { method: 'POST' }),
    onSuccess: async (_d, kind) => {
      setConfirmCancel(false);
      await queryClient.invalidateQueries({ queryKey: keys.organiserEvents });
      if (kind === 'delete') await navigate('/organiser', { replace: true });
      else await queryClient.invalidateQueries({ queryKey: keys.organiserEvent(eventId) });
    },
  });

  if (isPending) return <Spinner label="Loading event" />;
  if (error) return <Alert title="Couldn't load this event">{errorMessage(error)}</Alert>;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tickets', label: 'Ticket types' },
    { id: 'promos', label: 'Promo codes' },
    { id: 'orders', label: 'Orders' },
  ];

  return (
    <>
      <Link
        to="/organiser"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Dashboard
      </Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <EventStatusBadge status={event.status} />
            <span className="text-sm text-slate-500">
              {formatDateTime(event.startsAt)} · {event.venue.city}
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{event.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {event.status === 'published' && (
            <>
              <ButtonLink to={`/events/${event.slug}`} variant="secondary" target="_blank">
                <ExternalLink className="size-4" aria-hidden /> Public page
              </ButtonLink>
              <ButtonLink to={`/organiser/events/${event.id}/check-in`}>
                <ScanLine className="size-4" aria-hidden /> Check-in
              </ButtonLink>
            </>
          )}
          {event.status !== 'cancelled' && (
            <ButtonLink to={`/organiser/events/${event.id}/edit`} variant="secondary">
              <Pencil className="size-4" aria-hidden /> Edit
            </ButtonLink>
          )}
          {event.status === 'draft' && (
            <>
              <Button
                onClick={() => action.mutate('submit')}
                loading={action.isPending && action.variables === 'submit'}
              >
                <Send className="size-4" aria-hidden /> Submit for review
              </Button>
              <Button
                variant="ghost"
                onClick={() => action.mutate('delete')}
                aria-label="Delete draft"
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
          {event.status !== 'cancelled' && event.status !== 'draft' && (
            <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
              <XCircle className="size-4" aria-hidden /> Cancel event
            </Button>
          )}
        </div>
      </div>

      {action.error && (
        <div className="mb-4">
          <Alert>{errorMessage(action.error)}</Alert>
        </div>
      )}
      {event.status === 'draft' && event.rejectionReason && (
        <div className="mb-4">
          <Alert tone="amber" title="Changes requested by the reviewer">
            {event.rejectionReason}
          </Alert>
        </div>
      )}
      {event.status === 'pending' && (
        <div className="mb-4">
          <Alert tone="blue">
            This event is waiting for an admin to review it. You'll be able to sell tickets once
            it's approved.
          </Alert>
        </div>
      )}

      <div className="mb-6 border-b border-slate-200" role="tablist">
        <div className="-mb-px flex gap-6 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium',
                tab === t.id
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel">
        {tab === 'overview' && <Overview event={event} />}
        {tab === 'tickets' && <Tickets event={event} />}
        {tab === 'promos' && <Promos event={event} />}
        {tab === 'orders' && <Orders event={event} />}
      </div>

      <Modal
        open={confirmCancel}
        title="Cancel this event?"
        onClose={() => setConfirmCancel(false)}
      >
        <p className="text-sm text-slate-600">
          Sales stop immediately and <strong>every buyer is refunded automatically</strong>. This
          can't be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
            Keep event
          </Button>
          <Button
            variant="danger"
            loading={action.isPending}
            onClick={() => action.mutate('cancel')}
          >
            Cancel and refund everyone
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function ManageEventPage() {
  return (
    <RequireAuth roles={['organiser', 'admin']}>
      <Page>
        <Manage />
      </Page>
    </RequireAuth>
  );
}
