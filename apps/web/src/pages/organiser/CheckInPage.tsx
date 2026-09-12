import { SOCKET_EVENTS, type CheckInResponse, type CheckInStats } from '@gatherly/types';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Keyboard,
  RotateCcw,
  ShieldX,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { RequireAuth } from '../../components/layout/guards';
import { Page } from '../../components/layout/Page';
import { Alert, Button, Card, Input, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { formatTime } from '../../lib/format';
import { organiserEventQuery } from '../../lib/queries';
import { emitWithAck, getSocket } from '../../lib/socket';

const QrScanner = lazy(() => import('../../components/organiser/QrScanner'));

/** Ignore the same code seen again within this window — a QR stays in frame for several frames. */
const REPEAT_WINDOW_MS = 4_000;

function ResultCard({ result }: { result: CheckInResponse }) {
  const style = {
    admitted: { bg: 'bg-emerald-600', icon: CheckCircle2, heading: 'Admit' },
    'already-used': { bg: 'bg-amber-500', icon: TriangleAlert, heading: 'Already used' },
    refunded: { bg: 'bg-red-600', icon: ShieldX, heading: 'Refunded' },
    'wrong-event': { bg: 'bg-red-600', icon: ShieldX, heading: 'Wrong event' },
    invalid: { bg: 'bg-red-600', icon: ShieldX, heading: 'Invalid' },
  }[result.result];
  const Icon = style.icon;
  return (
    <div
      className={cn('rounded-xl p-6 text-white shadow-lg', style.bg)}
      role="status"
      aria-live="assertive"
    >
      <div className="flex items-center gap-3">
        <Icon className="size-10 shrink-0" aria-hidden />
        <div>
          <p className="text-2xl font-extrabold uppercase tracking-wide">{style.heading}</p>
          <p className="text-white/90">{result.message}</p>
        </div>
      </div>
      {result.ticket && (
        <dl className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-black/15 p-3 text-sm">
          <dt className="text-white/70">Attendee</dt>
          <dd className="font-semibold">{result.ticket.attendeeName}</dd>
          <dt className="text-white/70">Ticket</dt>
          <dd className="font-semibold">{result.ticket.tierName}</dd>
          <dt className="text-white/70">Serial</dt>
          <dd className="font-mono">{result.ticket.serial}</dd>
          {result.result === 'already-used' && result.ticket.checkedInAt && (
            <>
              <dt className="text-white/70">First scanned</dt>
              <dd className="font-semibold">{formatTime(result.ticket.checkedInAt)}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function CheckIn() {
  const { eventId = '' } = useParams();
  const { data: event, isPending, error } = useQuery(organiserEventQuery(eventId));
  const [result, setResult] = useState<CheckInResponse | null>(null);
  const [stats, setStats] = useState<CheckInStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [serial, setSerial] = useState('');
  const [camera, setCamera] = useState(true);
  const lastScan = useRef<{ text: string; at: number } | null>(null);

  useEffect(() => {
    if (!eventId) return;
    const socket = getSocket();
    const subscribe = () =>
      void emitWithAck<CheckInStats>(SOCKET_EVENTS.subscribeOrganiser, eventId).then(
        (r) => r.ok && setStats(r.data),
      );
    const onCount = (payload: CheckInStats & { eventId: string }) =>
      payload.eventId === eventId && setStats(payload);
    socket.on(SOCKET_EVENTS.checkIn, onCount);
    socket.on('connect', subscribe);
    if (socket.connected) subscribe();
    return () => {
      socket.off(SOCKET_EVENTS.checkIn, onCount);
      socket.off('connect', subscribe);
    };
  }, [eventId]);

  const submit = async (body: { qrPayload: string } | { serial: string }) => {
    setBusy(true);
    setScanError(null);
    try {
      const res = await api<CheckInResponse>(`/organiser/events/${eventId}/check-in`, {
        method: 'POST',
        body,
      });
      setResult(res);
      setStats(res.stats);
      if ('vibrate' in navigator) navigator.vibrate(res.result === 'admitted' ? 80 : [60, 60, 60]);
    } catch (err) {
      setScanError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onScan = (text: string) => {
    const now = Date.now();
    if (lastScan.current?.text === text && now - lastScan.current.at < REPEAT_WINDOW_MS) return;
    lastScan.current = { text, at: now };
    void submit({ qrPayload: text });
  };

  const onManual = (e: FormEvent) => {
    e.preventDefault();
    if (!serial.trim()) return;
    void submit({ serial: serial.trim() }).then(() => setSerial(''));
  };

  if (isPending) return <Spinner label="Loading event" />;
  if (error) return <Alert title="Couldn't load this event">{errorMessage(error)}</Alert>;
  if (event.status !== 'published') {
    return <Alert tone="amber" title="Check-in is only available for published events" />;
  }

  const pct = stats?.total ? Math.round((stats.checkedIn / stats.total) * 100) : 0;

  return (
    <>
      <Link
        to={`/organiser/events/${eventId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> {event.title}
      </Link>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Scan tickets</h2>
              <Button variant="ghost" size="sm" onClick={() => setCamera((c) => !c)}>
                {camera ? 'Stop camera' : 'Start camera'}
              </Button>
            </div>
            {camera ? (
              <Suspense
                fallback={<div className="aspect-square animate-pulse rounded-xl bg-slate-200" />}
              >
                <QrScanner onScan={onScan} paused={busy} />
              </Suspense>
            ) : (
              <div className="grid aspect-square place-items-center rounded-xl bg-slate-100 text-sm text-slate-500">
                Camera off
              </div>
            )}
          </Card>

          <Card className="p-4">
            <form onSubmit={onManual} className="flex gap-2">
              <label htmlFor="serial" className="sr-only">
                Ticket serial
              </label>
              <div className="relative flex-1">
                <Keyboard
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <Input
                  id="serial"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value.toUpperCase())}
                  placeholder="GTH-XXXX-XXXX"
                  className="pl-9 font-mono uppercase"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" loading={busy} disabled={!serial.trim()}>
                Check in
              </Button>
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-slate-600">
                <Users className="size-5" aria-hidden />
                <span className="text-sm font-medium">Checked in</span>
              </div>
              <span className="text-2xl font-bold tabular-nums" aria-live="polite">
                {stats ? `${stats.checkedIn} / ${stats.total}` : '—'}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </Card>

          {scanError && <Alert>{scanError}</Alert>}
          {result ? (
            <>
              <ResultCard result={result} />
              <Button variant="secondary" className="w-full" onClick={() => setResult(null)}>
                <RotateCcw className="size-4" aria-hidden /> Ready for next
              </Button>
            </>
          ) : (
            <Card className="grid min-h-48 place-items-center p-6 text-center text-slate-500">
              <p>Point the camera at a ticket's QR code, or type the serial printed under it.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

export function CheckInPage() {
  return (
    <RequireAuth roles={['organiser', 'admin']}>
      <Page>
        <CheckIn />
      </Page>
    </RequireAuth>
  );
}
