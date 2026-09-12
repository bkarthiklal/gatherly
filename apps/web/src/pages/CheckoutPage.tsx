import type { CheckoutSession, Order, OrderQuote } from '@gatherly/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, ShoppingBag, Tag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Countdown, useSecondsLeft } from '../components/checkout/Countdown';
import { RequireAuth } from '../components/layout/guards';
import { Page } from '../components/layout/Page';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Spinner,
} from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatMoney, formatMoneyExact } from '../lib/format';
import { holdsQuery, keys } from '../lib/queries';
import { openRazorpayCheckout } from '../lib/razorpay';

function Checkout() {
  const [params] = useSearchParams();
  const holdIds = (params.get('holds') ?? '').split(',').filter(Boolean);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: holds, isPending } = useQuery(holdsQuery);
  const mine = holds?.filter((h) => holdIds.includes(h.id)) ?? [];
  const expiresAt = mine.length ? mine.map((h) => h.expiresAt).sort()[0] : undefined;
  const secondsLeft = useSecondsLeft(expiresAt);

  const [promo, setPromo] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<string | undefined>();
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allFound = mine.length === holdIds.length && holdIds.length > 0;

  useEffect(() => {
    if (!allFound) return;
    let cancelled = false;
    api<OrderQuote>('/orders/quote', { method: 'POST', body: { holdIds, promoCode: appliedPromo } })
      .then((q) => !cancelled && setQuote(q))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (appliedPromo) {
          setPromoError(errorMessage(err));
          setAppliedPromo(undefined);
        } else setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
    // holdIds is derived from the URL and stable for the life of the page.
  }, [allFound, appliedPromo, params]);

  if (isPending) return <Spinner label="Loading your reservation" />;

  if (!allFound || (secondsLeft === 0 && !order)) {
    return (
      <EmptyState
        icon={<ShoppingBag className="size-10" />}
        title="This reservation has expired"
        description="Seats are only held for a few minutes so others get a fair chance. They have been released — you can reserve again if they are still available."
        action={<ButtonLink to="/events">Back to events</ButtonLink>}
      />
    );
  }

  const eventId = mine[0]!.eventId;

  const goToOrder = async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.holds }),
      queryClient.invalidateQueries({ queryKey: keys.tickets }),
      queryClient.invalidateQueries({ queryKey: keys.orders }),
    ]);
    await navigate(`/orders/${id}`, { replace: true });
  };

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const current =
        order ??
        (await api<Order>('/orders', {
          method: 'POST',
          body: { holdIds, promoCode: appliedPromo },
        }));
      setOrder(current);

      const session = await api<CheckoutSession>(`/orders/${current.id}/pay`, { method: 'POST' });
      if (session.kind === 'free') {
        await goToOrder(current.id);
        return;
      }

      await openRazorpayCheckout(session, {
        onSuccess: (result) => {
          void api<Order>(`/orders/${current.id}/verify`, { method: 'POST', body: result })
            .catch(() => undefined) // the webhook confirms the order even if this call fails
            .finally(() => void goToOrder(current.id));
        },
        onDismiss: () => setBusy(false),
        onFailure: (message) => {
          setError(
            `Payment failed: ${message}. You can try again while your seats are still held.`,
          );
          setBusy(false);
        },
      });
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 503
          ? 'Online payments are not configured on this server yet.'
          : errorMessage(err),
      );
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      if (order) await api(`/orders/${order.id}/cancel`, { method: 'POST' });
      else
        await Promise.all(
          holdIds.map((id) => api(`/holds/${id}`, { method: 'DELETE' }).catch(() => undefined)),
        );
      await queryClient.invalidateQueries({ queryKey: keys.holds });
    } finally {
      await navigate(-1);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Order summary</h2>
          <Countdown seconds={secondsLeft} />
        </div>
        {quote ? (
          <>
            <ul className="divide-y divide-slate-100">
              {quote.items.map((item) => (
                <li key={item.tierId} className="flex justify-between py-3 text-sm">
                  <span>
                    {item.quantity} × {item.tierName}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatMoneyExact(item.quantity * item.unitPriceMinor)}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 space-y-2 border-t border-slate-200 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Subtotal</dt>
                <dd className="tabular-nums">{formatMoneyExact(quote.subtotalMinor)}</dd>
              </div>
              {quote.discountMinor > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <dt>Discount ({quote.promoCode})</dt>
                  <dd className="tabular-nums">−{formatMoneyExact(quote.discountMinor)}</dd>
                </div>
              )}
              <div className="flex justify-between text-base font-bold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoneyExact(quote.totalMinor)}</dd>
              </div>
            </dl>
          </>
        ) : (
          <Spinner label="Calculating total" />
        )}

        {!order && (
          <form
            className="mt-6 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPromoError(null);
              setAppliedPromo(promo.trim() || undefined);
            }}
          >
            <label htmlFor="promo" className="sr-only">
              Promo code
            </label>
            <div className="relative flex-1">
              <Tag
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                id="promo"
                value={promo}
                onChange={(e) => setPromo(e.target.value.toUpperCase())}
                placeholder="Promo code"
                className="pl-9 uppercase"
              />
            </div>
            <Button type="submit" variant="secondary" disabled={!promo.trim()}>
              Apply
            </Button>
          </form>
        )}
        {promoError && <p className="mt-2 text-sm text-red-600">{promoError}</p>}
        {order && appliedPromo && (
          <p className="mt-4 text-xs text-slate-500">Promo code locked in for this order.</p>
        )}
      </Card>

      <div className="space-y-4">
        <Card className="p-6">
          {error && (
            <div className="mb-4">
              <Alert>{error}</Alert>
            </div>
          )}
          <Button
            size="lg"
            className="w-full"
            loading={busy}
            disabled={!quote}
            onClick={() => void pay()}
          >
            <Lock className="size-4" aria-hidden />
            {quote
              ? quote.totalMinor === 0
                ? 'Confirm free tickets'
                : `Pay ${formatMoney(quote.totalMinor)}`
              : 'Pay'}
          </Button>
          <Button
            variant="ghost"
            className="mt-2 w-full"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancel and release seats
          </Button>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            You'll pay on Razorpay's secure page. Gatherly never sees or stores your card or UPI
            details. If your reservation runs out mid-payment and the seats are gone, you are
            refunded automatically.
          </p>
        </Card>
        <p className="text-center text-xs text-slate-400">
          Reservation for event {eventId.slice(-6)}
        </p>
      </div>
    </div>
  );
}

export function CheckoutPage() {
  return (
    <RequireAuth>
      <Page>
        <PageHeader title="Checkout" />
        <Checkout />
      </Page>
    </RequireAuth>
  );
}
