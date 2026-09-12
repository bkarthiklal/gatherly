import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, MapPin } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { RequireAuth } from '../components/layout/guards';
import { Page } from '../components/layout/Page';
import { Alert, Badge, Button, Card, Spinner } from '../components/ui';
import { downloadFile } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateLong, formatDateTime, formatTime } from '../lib/format';
import { ticketQuery } from '../lib/queries';

function TicketDetail() {
  const { ticketId = '' } = useParams();
  const { data: ticket, isPending, error } = useQuery(ticketQuery(ticketId));
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (isPending) return <Spinner label="Loading ticket" />;
  if (error) return <Alert title="Couldn't load this ticket">{errorMessage(error)}</Alert>;

  const usable = ticket.status === 'valid';

  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadFile(`/tickets/${ticket.id}/pdf`, `${ticket.serial}.pdf`);
    } catch (err) {
      setDownloadError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Link
        to="/tickets"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> My tickets
      </Link>
      <Card className="overflow-hidden">
        <div className="bg-brand-600 px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-100">
            Admit one
          </p>
          <h1 className="mt-1 text-xl font-bold">{ticket.eventTitle}</h1>
          <p className="mt-1 text-sm text-brand-100">
            {formatDateLong(ticket.startsAt)} · {formatTime(ticket.startsAt)}
          </p>
        </div>

        <div className="flex flex-col items-center px-6 py-8">
          <div className={usable ? '' : 'opacity-25 grayscale'}>
            <img
              src={ticket.qrDataUrl}
              alt={`QR code for ticket ${ticket.serial}`}
              className="size-64 rounded-lg ring-1 ring-slate-200"
            />
          </div>
          <p className="mt-4 font-mono text-lg font-semibold tracking-wider">{ticket.serial}</p>
          <div className="mt-2">
            {ticket.status === 'valid' && <Badge tone="green">Valid · show this at the door</Badge>}
            {ticket.status === 'used' && (
              <Badge tone="slate">
                Checked in {ticket.checkedInAt ? formatDateTime(ticket.checkedInAt) : ''}
              </Badge>
            )}
            {ticket.status === 'refunded' && <Badge tone="amber">Refunded — no longer valid</Badge>}
            {ticket.status === 'void' && <Badge tone="red">Void</Badge>}
          </div>
        </div>

        <dl className="grid gap-4 border-t border-dashed border-slate-300 px-6 py-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Attendee</dt>
            <dd className="font-medium">{ticket.attendeeName}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Ticket type</dt>
            <dd className="font-medium">{ticket.tierName}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Venue</dt>
            <dd className="flex items-start gap-1 font-medium">
              <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
              {ticket.venue.name}, {ticket.venue.addressLine}, {ticket.venue.city}
            </dd>
          </div>
        </dl>

        <div className="border-t border-slate-100 px-6 py-4">
          {downloadError && (
            <div className="mb-3">
              <Alert>{downloadError}</Alert>
            </div>
          )}
          <Button
            variant="secondary"
            className="w-full"
            loading={downloading}
            onClick={() => void download()}
          >
            <Download className="size-4" aria-hidden /> Download PDF
          </Button>
          <p className="mt-3 text-center text-xs text-slate-500">
            Each ticket admits one person, once. Don't share the QR code — the first scan wins.
          </p>
        </div>
      </Card>
    </>
  );
}

export function TicketPage() {
  return (
    <RequireAuth>
      <Page narrow>
        <div className="mx-auto max-w-md">
          <TicketDetail />
        </div>
      </Page>
    </RequireAuth>
  );
}
