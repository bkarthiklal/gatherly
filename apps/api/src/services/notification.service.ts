import { env } from '../config/env.js';
import { getEmailTransport } from '../lib/email.js';
import { logger } from '../lib/logger.js';
import { EventModel } from '../models/event.model.js';
import { OrderModel } from '../models/order.model.js';
import { TicketModel } from '../models/ticket.model.js';
import { UserModel } from '../models/user.model.js';
import { formatEventDate, renderTicketsPdf } from './ticket.service.js';

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const rupees = (minor: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(minor / 100);

/**
 * Emails the buyer their tickets as a PDF attachment. Runs as a retried job.
 * `ticketsEmailedAt` is claimed only after the provider accepts the message,
 * so a job that crashed before sending is retried, and one that already sent
 * is not repeated.
 */
export async function sendTicketEmail(orderId: string): Promise<'sent' | 'skipped'> {
  const order = await OrderModel.findById(orderId).lean();
  if (order?.status !== 'paid' || order.ticketsEmailedAt) return 'skipped';

  const [buyer, event, tickets] = await Promise.all([
    UserModel.findById(order.userId).select('name email').lean(),
    EventModel.findById(order.eventId).lean(),
    TicketModel.find({ orderId: order._id, status: 'valid' }).sort({ createdAt: 1 }).lean(),
  ]);
  if (!buyer || !event || tickets.length === 0) return 'skipped';

  const pdf = await renderTicketsPdf(tickets, event);
  const when = formatEventDate(event.startsAt);
  const where = `${event.venue.name}, ${event.venue.addressLine}, ${event.venue.city}`;
  const link = `${env.WEB_APP_URL}/tickets`;
  const count = `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}`;

  await getEmailTransport().send({
    to: buyer.email,
    subject: `Your ${count} for ${event.title}`,
    text: [
      `Hi ${buyer.name},`,
      '',
      `You're going to ${event.title}.`,
      `${when}`,
      `${where}`,
      '',
      `${count} · ${rupees(order.totalMinor)} paid`,
      'Your tickets are attached as a PDF. Show the QR code at the entrance.',
      `You can also open them any time at ${link}`,
    ].join('\n'),
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:auto;color:#111827">
        <p>Hi ${escapeHtml(buyer.name)},</p>
        <h2 style="margin:16px 0 4px">You're going to ${escapeHtml(event.title)}</h2>
        <p style="margin:0;color:#374151">${escapeHtml(when)}<br>${escapeHtml(where)}</p>
        <p style="margin:16px 0">${count} · <strong>${rupees(order.totalMinor)}</strong> paid</p>
        <p>Your tickets are attached as a PDF. Show the QR code at the entrance — each ticket admits one person, once.</p>
        <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">View my tickets</a></p>
      </div>`,
    attachments: [{ filename: `gatherly-tickets-${order._id.toString()}.pdf`, content: pdf }],
  });

  await OrderModel.updateOne(
    { _id: order._id, ticketsEmailedAt: null },
    { $set: { ticketsEmailedAt: new Date() } },
  );
  logger.info({ orderId, to: buyer.email, tickets: tickets.length }, 'Ticket email sent');
  return 'sent';
}
