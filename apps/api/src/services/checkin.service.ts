import type { CheckInInput, CheckInResponse, CheckInStats } from '@gatherly/types';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { publish } from '../lib/domain-events.js';
import { AppError } from '../lib/errors.js';
import { parseTicketQr, safeEqual, signTicket } from '../lib/signatures.js';
import { assertCanManage, type AuthContext } from '../middleware/auth.js';
import { EventModel } from '../models/event.model.js';
import { TicketModel, type Ticket } from '../models/ticket.model.js';

export async function checkInStats(eventId: Types.ObjectId): Promise<CheckInStats> {
  const [checkedIn, total] = await Promise.all([
    TicketModel.countDocuments({ eventId, status: 'used' }),
    TicketModel.countDocuments({ eventId, status: { $in: ['valid', 'used'] } }),
  ]);
  return { checkedIn, total };
}

async function loadManagedEventId(auth: AuthContext, eventId: string): Promise<Types.ObjectId> {
  const event = await EventModel.findById(eventId).select('organiserId status').lean();
  assertCanManage(event?.organiserId, auth);
  if (event!.status === 'cancelled') throw AppError.conflict('This event was cancelled');
  return event!._id;
}

export async function getCheckInStats(auth: AuthContext, eventId: string): Promise<CheckInStats> {
  return checkInStats(await loadManagedEventId(auth, eventId));
}

function ticketSummary(ticket: Ticket | null): CheckInResponse['ticket'] {
  return ticket
    ? {
        serial: ticket.serial,
        tierName: ticket.tierName,
        attendeeName: ticket.attendeeName,
        checkedInAt: ticket.checkedInAt?.toISOString() ?? null,
      }
    : null;
}

/**
 * Admits a ticket at the door, at most once.
 *
 * A QR scan is checked in two steps:
 * 1. Signature, recomputed over the ticket id, serial and *this* event's id.
 *    A forged or edited code fails, and so does a genuine ticket for a
 *    different event, because the event id is part of what was signed.
 * 2. A conditional atomic update from `valid` to `used`. When two stewards
 *    scan copies of the same ticket in the same instant, both requests reach
 *    the database, but the filter `status: 'valid'` can match only once:
 *    one update succeeds and the other matches nothing and is told the
 *    ticket was already used, and when.
 *
 * Typing the serial skips step 1 — the steward is reading a printed code,
 * and the serial alone is unguessable (40 random bits) — but still passes
 * through step 2.
 */
export async function checkIn(
  auth: AuthContext,
  eventId: string,
  input: CheckInInput,
): Promise<CheckInResponse> {
  const eventObjectId = await loadManagedEventId(auth, eventId);
  const respond = async (
    result: CheckInResponse['result'],
    message: string,
    ticket: Ticket | null,
  ): Promise<CheckInResponse> => ({
    result,
    message,
    ticket: ticketSummary(ticket),
    stats: await checkInStats(eventObjectId),
  });

  let lookup: { _id: string } | { serial: string };
  if ('qrPayload' in input) {
    const parsed = parseTicketQr(input.qrPayload);
    if (!parsed) return respond('invalid', 'Not a Gatherly ticket', null);
    const expected = signTicket(env.TICKET_SIGNING_SECRET, parsed.ticketId, parsed.serial, eventId);
    if (!safeEqual(expected, parsed.signature)) {
      const other = await TicketModel.findOne({
        _id: parsed.ticketId,
        serial: parsed.serial,
      }).lean();
      return other && !other.eventId.equals(eventObjectId)
        ? respond('wrong-event', 'This ticket is for a different event', null)
        : respond('invalid', 'Ticket signature is not valid — possible forgery', null);
    }
    lookup = { _id: parsed.ticketId };
  } else {
    lookup = { serial: input.serial };
  }

  const admitted = await TicketModel.findOneAndUpdate(
    { ...lookup, eventId: eventObjectId, status: 'valid' },
    {
      $set: {
        status: 'used',
        checkedInAt: new Date(),
        checkedInBy: new Types.ObjectId(auth.userId),
      },
    },
    { returnDocument: 'after' },
  ).lean();

  if (admitted) {
    await publish('ticket.checked-in', { eventId, ticketId: admitted._id.toString() });
    return respond('admitted', `Welcome, ${admitted.attendeeName}`, admitted);
  }

  const existing = await TicketModel.findOne(lookup).lean();
  if (!existing) return respond('invalid', 'No ticket with that code', null);
  if (!existing.eventId.equals(eventObjectId))
    return respond('wrong-event', 'This ticket is for a different event', null);
  if (existing.status === 'used') {
    return respond('already-used', 'Already checked in', existing);
  }
  return respond('refunded', 'This ticket was refunded and is no longer valid', existing);
}
