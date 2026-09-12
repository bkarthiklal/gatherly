import { randomBytes } from 'node:crypto';
import type { Ticket as TicketDto, TicketWithQr } from '@gatherly/types';
import type { ClientSession, Types } from 'mongoose';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { ticketQrPayload } from '../lib/signatures.js';
import type { AuthContext } from '../middleware/auth.js';
import { EventModel, type Event } from '../models/event.model.js';
import type { Order } from '../models/order.model.js';
import { TicketModel, type Ticket } from '../models/ticket.model.js';

// Crockford base32 without I, L, O, U — nothing a door steward can misread.
const SERIAL_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function newSerial(): string {
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => SERIAL_ALPHABET[b % 32]).join('');
  return `GTH-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

/** One ticket per seat, created inside the payment transaction. */
export async function mintTickets(
  order: Order,
  attendeeName: string,
  session: ClientSession,
): Promise<Ticket[]> {
  const docs = order.items.flatMap((item) =>
    Array.from({ length: item.quantity }, () => ({
      orderId: order._id,
      eventId: order.eventId,
      tierId: item.tierId,
      userId: order.userId,
      tierName: item.tierName,
      attendeeName,
      serial: newSerial(),
    })),
  );
  const created = await TicketModel.insertMany(docs, { session });
  return created.map((t) => t.toObject());
}

export function qrPayloadFor(ticket: Pick<Ticket, '_id' | 'serial' | 'eventId'>): string {
  return ticketQrPayload(
    env.TICKET_SIGNING_SECRET,
    ticket._id.toString(),
    ticket.serial,
    ticket.eventId.toString(),
  );
}

function toTicketDto(ticket: Ticket, event: Event): TicketDto {
  return {
    id: ticket._id.toString(),
    serial: ticket.serial,
    status: ticket.status,
    orderId: ticket.orderId.toString(),
    eventId: ticket.eventId.toString(),
    eventTitle: event.title,
    eventSlug: event.slug,
    venue: { name: event.venue.name, addressLine: event.venue.addressLine, city: event.venue.city },
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    tierName: ticket.tierName,
    attendeeName: ticket.attendeeName,
    checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
  };
}

async function eventsById(ids: Types.ObjectId[]): Promise<Map<string, Event>> {
  const events = await EventModel.find({ _id: { $in: ids } }).lean();
  return new Map(events.map((e) => [e._id.toString(), e]));
}

export async function listMyTickets(auth: AuthContext): Promise<TicketDto[]> {
  const tickets = await TicketModel.find({ userId: auth.userId })
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  const events = await eventsById([...new Set(tickets.map((t) => t.eventId))]);
  return tickets.flatMap((t) => {
    const event = events.get(t.eventId.toString());
    return event ? [toTicketDto(t, event)] : [];
  });
}

export async function getMyTicket(auth: AuthContext, ticketId: string): Promise<TicketWithQr> {
  const ticket = await TicketModel.findOne({ _id: ticketId, userId: auth.userId }).lean();
  if (!ticket) throw AppError.notFound('Ticket not found');
  const event = await EventModel.findById(ticket.eventId).lean();
  if (!event) throw AppError.notFound('Ticket not found');

  const qrPayload = qrPayloadFor(ticket);
  return {
    ...toTicketDto(ticket, event),
    qrPayload,
    // Error-correction level M survives a cracked phone screen or glare.
    qrDataUrl: await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    }),
  };
}

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'full',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

export function formatEventDate(date: Date): string {
  return `${dateFormat.format(date)} IST`;
}

/** Renders one A5 page per ticket. Returned as a Buffer for download or email attachment. */
export async function renderTicketsPdf(tickets: Ticket[], event: Event): Promise<Buffer> {
  const qrImages = await Promise.all(
    tickets.map((t) =>
      QRCode.toBuffer(qrPayloadFor(t), { errorCorrectionLevel: 'M', margin: 1, width: 400 }),
    ),
  );

  const doc = new PDFDocument({
    size: 'A5',
    margin: 36,
    info: { Title: `Tickets — ${event.title}` },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  tickets.forEach((ticket, i) => {
    if (i > 0) doc.addPage();
    const width = doc.page.width - 72;
    doc.fontSize(9).fillColor('#6b7280').text('GATHERLY · ADMIT ONE', { align: 'center' });
    doc.moveDown(0.6);
    doc.fontSize(18).fillColor('#111827').text(event.title, { align: 'center', width });
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .fillColor('#374151')
      .text(formatEventDate(event.startsAt), { align: 'center' });
    doc.text(`${event.venue.name}, ${event.venue.addressLine}, ${event.venue.city}`, {
      align: 'center',
    });
    doc.moveDown(0.8);

    const qrSize = 200;
    doc.image(qrImages[i]!, (doc.page.width - qrSize) / 2, doc.y, {
      width: qrSize,
      height: qrSize,
    });
    doc.y += qrSize + 12;

    doc
      .fontSize(14)
      .fillColor('#111827')
      .text(ticket.serial, { align: 'center', characterSpacing: 1 });
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .fillColor('#374151')
      .text(`${ticket.tierName} · ${ticket.attendeeName}`, { align: 'center' });
    doc.moveDown(1);
    doc
      .fontSize(8)
      .fillColor('#6b7280')
      .text('Valid for one entry. The first scan admits; any copy scanned afterwards is refused.', {
        align: 'center',
      });
    doc.text(`Ticket ${i + 1} of ${tickets.length}`, { align: 'center' });
  });

  doc.end();
  return finished;
}

export async function myTicketPdf(
  auth: AuthContext,
  ticketId: string,
): Promise<{ filename: string; pdf: Buffer }> {
  const ticket = await TicketModel.findOne({ _id: ticketId, userId: auth.userId }).lean();
  if (!ticket) throw AppError.notFound('Ticket not found');
  const event = await EventModel.findById(ticket.eventId).lean();
  if (!event) throw AppError.notFound('Ticket not found');
  return { filename: `${ticket.serial}.pdf`, pdf: await renderTicketsPdf([ticket], event) };
}
