import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { RequireAuth } from '../components/layout/guards';
import { Page } from '../components/layout/Page';
import { Alert, Badge, ButtonLink, Card, Spinner } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatMoneyExact } from '../lib/format';
import { orderQuery, ticketsQuery } from '../lib/queries';

function OrderDetail() {
  const { orderId = '' } = useParams();
  const {
    data: order,
    error,
    isPending,
  } = useQuery({
    ...orderQuery(orderId),
    // The webhook may land a moment after the browser returns from Razorpay.
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 2_000 : false),
  });
  const { data: tickets } = useQuery({ ...ticketsQuery, enabled: order?.status === 'paid' });

  if (isPending) return <Spinner label="Loading order" />;
  if (error) return <Alert title="Couldn't load this order">{errorMessage(error)}</Alert>;

  const orderTickets = tickets?.filter((t) => t.orderId === order.id) ?? [];

  return (
    <div className="space-y-6">
      {order.status === 'paid' ? (
        <Card className="p-8 text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-500" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold">You're going to {order.eventTitle}!</h1>
          <p className="mt-2 text-slate-600">
            Your tickets are below and on their way to your inbox as a PDF.
          </p>
        </Card>
      ) : order.status === 'pending' ? (
        <Card className="p-8 text-center">
          <Clock className="mx-auto size-12 animate-pulse text-amber-500" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold">Confirming your payment…</h1>
          <p className="mt-2 text-slate-600">
            This usually takes a few seconds. You can safely leave this page — we'll email your
            tickets.
          </p>
        </Card>
      ) : (
        <Card className="p-8 text-center">
          <XCircle className="mx-auto size-12 text-red-500" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold capitalize">Order {order.status}</h1>
          <p className="mt-2 text-slate-600">
            {order.status === 'failed'
              ? 'We received your payment but could not issue the seats, so a full refund is on its way.'
              : order.status === 'refunded'
                ? 'This order was refunded.'
                : 'No payment was taken.'}
          </p>
        </Card>
      )}

      {orderTickets.length > 0 && (
        <Card className="p-6">
          <h2 className="mb-4 font-semibold">Your tickets</h2>
          <ul className="divide-y divide-slate-100">
            {orderTickets.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">{t.tierName}</p>
                  <p className="font-mono text-xs text-slate-500">{t.serial}</p>
                </div>
                <ButtonLink to={`/tickets/${t.id}`} variant="secondary" size="sm">
                  Show QR
                </ButtonLink>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Receipt</h2>
          <Badge
            tone={
              order.status === 'paid' ? 'green' : order.status === 'pending' ? 'amber' : 'slate'
            }
          >
            {order.status}
          </Badge>
        </div>
        <dl className="space-y-2 text-sm">
          {order.items.map((i) => (
            <div key={i.tierId} className="flex justify-between">
              <dt>
                {i.quantity} × {i.tierName}
              </dt>
              <dd className="tabular-nums">{formatMoneyExact(i.quantity * i.unitPriceMinor)}</dd>
            </div>
          ))}
          {order.discountMinor > 0 && (
            <div className="flex justify-between text-emerald-700">
              <dt>Discount ({order.promoCode})</dt>
              <dd className="tabular-nums">−{formatMoneyExact(order.discountMinor)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoneyExact(order.totalMinor)}</dd>
          </div>
          <div className="flex justify-between text-slate-500">
            <dt>Order</dt>
            <dd className="font-mono text-xs">{order.id}</dd>
          </div>
          {order.paidAt && (
            <div className="flex justify-between text-slate-500">
              <dt>Paid</dt>
              <dd>{formatDateTime(order.paidAt)}</dd>
            </div>
          )}
        </dl>
      </Card>

      <p className="text-center text-sm">
        <Link to="/tickets" className="font-medium text-brand-600 hover:text-brand-700">
          All my tickets →
        </Link>
      </p>
    </div>
  );
}

export function OrderPage() {
  return (
    <RequireAuth>
      <Page narrow>
        <OrderDetail />
      </Page>
    </RequireAuth>
  );
}
