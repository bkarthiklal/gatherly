import type { AuditLog, OrganiserEvent, Paginated } from '@gatherly/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Inbox } from 'lucide-react';
import { useState } from 'react';
import { RequireAuth } from '../../components/layout/guards';
import { Page } from '../../components/layout/Page';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Spinner,
  Textarea,
} from '../../components/ui';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { CATEGORY_LABELS, formatDateTime, formatMoney } from '../../lib/format';

function ReviewQueue() {
  const queryClient = useQueryClient();
  const queryKey = ['admin', 'events', 'pending'];
  const { data, isPending, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      api<Paginated<OrganiserEvent>>('/admin/events', { query: { status: 'pending' }, signal }),
  });
  const [rejecting, setRejecting] = useState<OrganiserEvent | null>(null);
  const [reason, setReason] = useState('');

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve
        ? api(`/admin/events/${id}/approve`, { method: 'POST' })
        : api(`/admin/events/${id}/reject`, { method: 'POST', body: { reason } }),
    onSuccess: async () => {
      setRejecting(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
  });

  if (isPending) return <Spinner label="Loading review queue" />;
  if (error) return <Alert>{errorMessage(error)}</Alert>;
  if (data.items.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="size-10" />}
        title="Nothing to review"
        description="New events submitted by organisers will appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      {decide.error && <Alert>{errorMessage(decide.error)}</Alert>}
      {data.items.map((e) => (
        <Card key={e.id} className="p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{CATEGORY_LABELS[e.category]}</Badge>
                <span className="text-sm text-slate-500">by {e.organiser.name}</span>
              </div>
              <h3 className="text-lg font-semibold">{e.title}</h3>
              <p className="text-sm text-slate-600">
                {formatDateTime(e.startsAt)} · {e.venue.name}, {e.venue.addressLine}, {e.venue.city}
              </p>
              <p className="line-clamp-3 whitespace-pre-line text-sm text-slate-700">
                {e.description}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {e.tiers.map((t) => (
                  <span
                    key={t.id}
                    className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
                  >
                    {t.name}: {formatMoney(t.priceMinor)} × {t.quantityTotal} (max {t.perUserLimit})
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 gap-2 lg:flex-col">
              <Button
                onClick={() => decide.mutate({ id: e.id, approve: true })}
                loading={
                  decide.isPending && decide.variables.approve && decide.variables.id === e.id
                }
              >
                <CheckCircle2 className="size-4" aria-hidden /> Approve
              </Button>
              <Button variant="secondary" onClick={() => setRejecting(e)}>
                Request changes
              </Button>
            </div>
          </div>
        </Card>
      ))}
      <Modal open={!!rejecting} title="Request changes" onClose={() => setRejecting(null)}>
        <form
          className="space-y-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (rejecting) decide.mutate({ id: rejecting.id, approve: false });
          }}
        >
          <p className="text-sm text-slate-600">
            The event returns to draft and the organiser sees your note.
          </p>
          <Field label="What needs to change?">
            {(p) => (
              <Textarea
                {...p}
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={5}
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={decide.isPending}>
              Send back
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function AuditTrail() {
  const [page, setPage] = useState(1);
  const { data, isPending, error } = useQuery({
    queryKey: ['admin', 'audit', page],
    queryFn: ({ signal }) =>
      api<Paginated<AuditLog>>('/admin/audit-logs', { query: { page, limit: 25 }, signal }),
    placeholderData: (prev) => prev,
  });
  if (isPending) return <Spinner label="Loading audit log" />;
  if (error) return <Alert>{errorMessage(error)}</Alert>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-slate-200 text-left text-slate-500">
          <tr>
            <th className="px-5 py-3 font-medium">When</th>
            <th className="px-5 py-3 font-medium">Who</th>
            <th className="px-5 py-3 font-medium">Action</th>
            <th className="px-5 py-3 font-medium">Target</th>
            <th className="px-5 py-3 font-medium">IP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.items.map((l) => (
            <tr key={l.id}>
              <td className="whitespace-nowrap px-5 py-2.5 text-slate-600">
                {formatDateTime(l.createdAt)}
              </td>
              <td className="px-5 py-2.5">{l.actor?.name ?? 'System'}</td>
              <td className="px-5 py-2.5 font-mono text-xs">{l.action}</td>
              <td className="px-5 py-2.5 font-mono text-xs text-slate-500">
                {l.targetType}:{l.targetId.slice(-8)}
              </td>
              <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{l.ip ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-slate-600">
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= data.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<'review' | 'audit'>('review');
  return (
    <RequireAuth roles={['admin']}>
      <Page>
        <PageHeader
          title="Admin"
          description="Review events before they go live, and see every privileged action."
        />
        <div className="mb-6 flex gap-2">
          {[
            { id: 'review' as const, label: 'Review queue', icon: Inbox },
            { id: 'audit' as const, label: 'Audit log', icon: ClipboardList },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
                tab === t.id
                  ? 'bg-brand-600 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
              )}
            >
              <t.icon className="size-4" aria-hidden /> {t.label}
            </button>
          ))}
        </div>
        {tab === 'review' ? <ReviewQueue /> : <AuditTrail />}
      </Page>
    </RequireAuth>
  );
}
