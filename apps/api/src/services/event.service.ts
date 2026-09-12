import { randomBytes } from 'node:crypto';
import type {
  AdminEventsQuery,
  CreateEventInput,
  CreateTicketTierInput,
  EventDetail,
  EventSummary,
  ListEventsQuery,
  OrganiserEvent,
  Paginated,
  TicketTier as TicketTierDto,
  UpdateEventInput,
  UpdateTicketTierInput,
  Venue,
} from '@gatherly/types';
import { Types, type QueryFilter } from 'mongoose';
import { withTransaction } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { assertCanManage, type AuthContext } from '../middleware/auth.js';
import { EventModel, type Event, type EventVenue } from '../models/event.model.js';
import {
  TicketTierModel,
  isOnSale,
  quantityAvailable,
  type TicketTier,
} from '../models/ticket-tier.model.js';
import { UserModel } from '../models/user.model.js';

// ─── Mapping ────────────────────────────────────────────────────────────────

function toVenueModel(venue: Venue): EventVenue {
  return {
    name: venue.name,
    addressLine: venue.addressLine,
    city: venue.city,
    cityKey: venue.city.trim().toLowerCase(),
    ...(venue.coordinates
      ? { location: { type: 'Point' as const, coordinates: venue.coordinates } }
      : {}),
  };
}

function toVenueDto(venue: EventVenue): Venue {
  const coordinates = venue.location?.coordinates;
  return {
    name: venue.name,
    addressLine: venue.addressLine,
    city: venue.city,
    ...(coordinates?.length === 2
      ? { coordinates: [coordinates[0], coordinates[1]] as [number, number] }
      : {}),
  };
}

export function toTierDto(tier: TicketTier, now = new Date()): TicketTierDto {
  return {
    id: tier._id.toString(),
    eventId: tier.eventId.toString(),
    name: tier.name,
    priceMinor: tier.priceMinor,
    currency: tier.currency,
    quantityTotal: tier.quantityTotal,
    quantitySold: tier.quantitySold,
    quantityHeld: tier.quantityHeld,
    quantityAvailable: quantityAvailable(tier),
    perUserLimit: tier.perUserLimit,
    onSale: isOnSale(tier, now),
    ...(tier.salesStartAt ? { salesStartAt: tier.salesStartAt.toISOString() } : {}),
    ...(tier.salesEndAt ? { salesEndAt: tier.salesEndAt.toISOString() } : {}),
  };
}

function toSummary(event: Event, tiers: TicketTier[], now = new Date()): EventSummary {
  const onSalePrices = tiers.filter((t) => isOnSale(t, now)).map((t) => t.priceMinor);
  return {
    id: event._id.toString(),
    title: event.title,
    slug: event.slug,
    category: event.category,
    venue: toVenueDto(event.venue),
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    bannerUrl: event.bannerUrl,
    status: event.status,
    fromPriceMinor: onSalePrices.length > 0 ? Math.min(...onSalePrices) : null,
  };
}

function toDetail(event: Event, tiers: TicketTier[], organiserName: string): EventDetail {
  const now = new Date();
  return {
    ...toSummary(event, tiers, now),
    description: event.description,
    organiser: { id: event.organiserId.toString(), name: organiserName },
    tiers: tiers.map((t) => toTierDto(t, now)),
  };
}

function toOrganiserEvent(
  event: Event,
  tiers: TicketTier[],
  organiserName: string,
): OrganiserEvent {
  return {
    ...toDetail(event, tiers, organiserName),
    rejectionReason: event.rejectionReason,
    createdAt: event.createdAt.toISOString(),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  // A short random suffix keeps slugs unique without a read-then-write race.
  return `${base || 'event'}-${randomBytes(3).toString('hex')}`;
}

function tierDocument(eventId: Types.ObjectId, input: CreateTicketTierInput, sortOrder: number) {
  return {
    eventId,
    name: input.name,
    priceMinor: input.priceMinor,
    currency: input.currency,
    quantityTotal: input.quantityTotal,
    perUserLimit: input.perUserLimit,
    salesStartAt: input.salesStartAt ? new Date(input.salesStartAt) : null,
    salesEndAt: input.salesEndAt ? new Date(input.salesEndAt) : null,
    sortOrder,
  };
}

function tiersFor(eventIds: Types.ObjectId[]): Promise<TicketTier[]> {
  return TicketTierModel.find({ eventId: { $in: eventIds } })
    .sort({ sortOrder: 1 })
    .lean();
}

function groupByEvent(tiers: TicketTier[]): Map<string, TicketTier[]> {
  const map = new Map<string, TicketTier[]>();
  for (const tier of tiers) {
    const key = tier.eventId.toString();
    map.set(key, [...(map.get(key) ?? []), tier]);
  }
  return map;
}

async function organiserName(id: Types.ObjectId): Promise<string> {
  const user = await UserModel.findById(id).select('name').lean();
  return user?.name ?? 'Unknown organiser';
}

async function loadManagedEvent(eventId: string, auth: AuthContext): Promise<Event> {
  const event = await EventModel.findById(eventId).lean();
  assertCanManage(event?.organiserId, auth);
  return event!;
}

function paginate<T>(items: T[], page: number, limit: number, total: number): Paginated<T> {
  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

// ─── Organiser ──────────────────────────────────────────────────────────────

export async function createEvent(
  auth: AuthContext,
  input: CreateEventInput,
): Promise<OrganiserEvent> {
  const organiserId = new Types.ObjectId(auth.userId);

  const { event, tiers } = await withTransaction(async (session) => {
    const [created] = await EventModel.create(
      [
        {
          organiserId,
          title: input.title,
          slug: slugify(input.title),
          description: input.description,
          category: input.category,
          venue: toVenueModel(input.venue),
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          bannerUrl: input.bannerUrl ?? null,
        },
      ],
      { session },
    );
    const createdTiers = await TicketTierModel.create(
      input.tiers.map((t, i) => tierDocument(created!._id, t, i)),
      { session, ordered: true },
    );
    return { event: created!.toObject(), tiers: createdTiers.map((t) => t.toObject()) };
  });

  return toOrganiserEvent(event, tiers, await organiserName(organiserId));
}

export async function listOrganiserEvents(auth: AuthContext): Promise<OrganiserEvent[]> {
  const events = await EventModel.find({ organiserId: auth.userId }).sort({ createdAt: -1 }).lean();
  const byEvent = groupByEvent(await tiersFor(events.map((e) => e._id)));
  const name = await organiserName(new Types.ObjectId(auth.userId));
  return events.map((e) => toOrganiserEvent(e, byEvent.get(e._id.toString()) ?? [], name));
}

export async function getOrganiserEvent(
  auth: AuthContext,
  eventId: string,
): Promise<OrganiserEvent> {
  const event = await loadManagedEvent(eventId, auth);
  return toOrganiserEvent(
    event,
    await tiersFor([event._id]),
    await organiserName(event.organiserId),
  );
}

const STRUCTURAL_FIELDS = ['category', 'venue', 'startsAt', 'endsAt'] as const;

export async function updateEvent(
  auth: AuthContext,
  eventId: string,
  input: UpdateEventInput,
): Promise<OrganiserEvent> {
  const event = await loadManagedEvent(eventId, auth);

  if (event.status === 'cancelled') throw AppError.conflict('A cancelled event cannot be edited');
  if (event.status !== 'draft' && STRUCTURAL_FIELDS.some((f) => input[f] !== undefined)) {
    throw AppError.conflict(
      'Date, venue and category can only change while the event is a draft — cancel and re-list instead',
    );
  }

  const startsAt = input.startsAt ? new Date(input.startsAt) : event.startsAt;
  const endsAt = input.endsAt ? new Date(input.endsAt) : event.endsAt;
  if (endsAt <= startsAt) throw AppError.badRequest('endsAt must be after startsAt');
  if (input.startsAt && startsAt <= new Date())
    throw AppError.badRequest('startsAt must be in the future');

  const update: Partial<Event> = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.venue !== undefined ? { venue: toVenueModel(input.venue) } : {}),
    ...(input.startsAt !== undefined ? { startsAt } : {}),
    ...(input.endsAt !== undefined ? { endsAt } : {}),
    ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
  };

  await EventModel.updateOne({ _id: event._id }, { $set: update });
  return getOrganiserEvent(auth, eventId);
}

/** Draft → pending. An admin must approve before the public can see it. */
export async function submitEvent(auth: AuthContext, eventId: string): Promise<OrganiserEvent> {
  const event = await loadManagedEvent(eventId, auth);
  if (event.startsAt <= new Date()) throw AppError.conflict('This event has already started');

  const updated = await EventModel.updateOne(
    { _id: event._id, status: 'draft' },
    { $set: { status: 'pending', rejectionReason: null } },
  );
  if (updated.modifiedCount === 0)
    throw AppError.conflict('Only a draft event can be submitted for review');
  return getOrganiserEvent(auth, eventId);
}

/**
 * Cancelling stops all sales immediately. Refunds for anyone who already
 * paid are dispatched by the payments module, which listens for this.
 */
export async function cancelEvent(auth: AuthContext, eventId: string): Promise<OrganiserEvent> {
  const event = await loadManagedEvent(eventId, auth);
  const updated = await EventModel.updateOne(
    { _id: event._id, status: { $ne: 'cancelled' } },
    { $set: { status: 'cancelled', cancelledAt: new Date() } },
  );
  if (updated.modifiedCount === 0) throw AppError.conflict('This event is already cancelled');
  await onEventCancelled(event._id);
  return getOrganiserEvent(auth, eventId);
}

/** Hook the payments module registers to refund buyers. A no-op until then. */
let onEventCancelled: (eventId: Types.ObjectId) => Promise<void> = () => Promise.resolve();
export function setEventCancelledHandler(
  handler: (eventId: Types.ObjectId) => Promise<void>,
): void {
  onEventCancelled = handler;
}

/** Hard delete is only for drafts with no inventory activity; anything else is cancelled instead. */
export async function deleteEvent(auth: AuthContext, eventId: string): Promise<void> {
  const event = await loadManagedEvent(eventId, auth);
  if (event.status !== 'draft')
    throw AppError.conflict('Only a draft can be deleted — cancel it instead');

  await withTransaction(async (session) => {
    const touched = await TicketTierModel.exists({
      eventId: event._id,
      $or: [{ quantitySold: { $gt: 0 } }, { quantityHeld: { $gt: 0 } }],
    }).session(session);
    if (touched) throw AppError.conflict('This event has ticket activity and cannot be deleted');
    await TicketTierModel.deleteMany({ eventId: event._id }, { session });
    await EventModel.deleteOne({ _id: event._id }, { session });
  });
}

export async function addTier(
  auth: AuthContext,
  eventId: string,
  input: CreateTicketTierInput,
): Promise<OrganiserEvent> {
  const event = await loadManagedEvent(eventId, auth);
  if (event.status === 'cancelled') throw AppError.conflict('A cancelled event cannot be edited');
  const count = await TicketTierModel.countDocuments({ eventId: event._id });
  if (count >= 10) throw AppError.conflict('An event can have at most 10 ticket tiers');
  await TicketTierModel.create(tierDocument(event._id, input, count));
  return getOrganiserEvent(auth, eventId);
}

export async function updateTier(
  auth: AuthContext,
  eventId: string,
  tierId: string,
  input: UpdateTicketTierInput,
): Promise<OrganiserEvent> {
  const event = await loadManagedEvent(eventId, auth);
  if (event.status === 'cancelled') throw AppError.conflict('A cancelled event cannot be edited');

  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.priceMinor !== undefined) set.priceMinor = input.priceMinor;
  if (input.perUserLimit !== undefined) set.perUserLimit = input.perUserLimit;
  if (input.salesStartAt !== undefined) set.salesStartAt = new Date(input.salesStartAt);
  if (input.salesEndAt !== undefined) set.salesEndAt = new Date(input.salesEndAt);
  if (input.quantityTotal !== undefined) set.quantityTotal = input.quantityTotal;

  const filter: QueryFilter<TicketTier> = { _id: tierId, eventId: event._id };
  if (input.quantityTotal !== undefined) {
    // Evaluated by the database against the live counters, so a sale landing
    // between our read and this write cannot push capacity below what is sold.
    filter.$expr = { $gte: [input.quantityTotal, { $add: ['$quantitySold', '$quantityHeld'] }] };
  }

  const updated = await TicketTierModel.updateOne(filter, { $set: set });
  if (updated.matchedCount === 0) {
    const exists = await TicketTierModel.exists({ _id: tierId, eventId: event._id });
    if (!exists) throw AppError.notFound('Ticket tier not found');
    throw AppError.conflict('Capacity cannot be lower than tickets already sold or on hold');
  }
  return getOrganiserEvent(auth, eventId);
}

export async function removeTier(
  auth: AuthContext,
  eventId: string,
  tierId: string,
): Promise<OrganiserEvent> {
  const event = await loadManagedEvent(eventId, auth);
  if (event.status !== 'draft')
    throw AppError.conflict('Tiers can only be removed while the event is a draft');
  if ((await TicketTierModel.countDocuments({ eventId: event._id })) <= 1) {
    throw AppError.conflict('An event needs at least one ticket tier');
  }
  const deleted = await TicketTierModel.deleteOne({
    _id: tierId,
    eventId: event._id,
    quantitySold: 0,
    quantityHeld: 0,
  });
  if (deleted.deletedCount === 0) throw AppError.notFound('Ticket tier not found');
  return getOrganiserEvent(auth, eventId);
}

// ─── Public ─────────────────────────────────────────────────────────────────

export async function listPublicEvents(query: ListEventsQuery): Promise<Paginated<EventSummary>> {
  const now = new Date();
  const filter: QueryFilter<Event> = { status: 'published', endsAt: { $gt: now } };
  if (query.category) filter.category = query.category;
  if (query.city) filter['venue.cityKey'] = query.city.toLowerCase();
  if (query.from || query.to) {
    filter.startsAt = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lte: new Date(query.to) } : {}),
    };
  }
  if (query.q) filter.$text = { $search: query.q };

  const skip = (query.page - 1) * query.limit;
  const cursor = query.q
    ? EventModel.find(filter, { score: { $meta: 'textScore' } }).sort({
        score: { $meta: 'textScore' },
        startsAt: 1,
      })
    : EventModel.find(filter).sort({ startsAt: 1 });

  const [events, total] = await Promise.all([
    cursor.skip(skip).limit(query.limit).lean(),
    EventModel.countDocuments(filter),
  ]);
  const byEvent = groupByEvent(await tiersFor(events.map((e) => e._id)));

  return paginate(
    events.map((e) => toSummary(e, byEvent.get(e._id.toString()) ?? [], now)),
    query.page,
    query.limit,
    total,
  );
}

/** Published and cancelled events are public (a cancelled page tells ticket holders what happened). */
export async function getPublicEvent(slug: string): Promise<EventDetail> {
  const event = await EventModel.findOne({
    slug,
    status: { $in: ['published', 'cancelled'] },
  }).lean();
  if (!event) throw AppError.notFound('Event not found');
  return toDetail(event, await tiersFor([event._id]), await organiserName(event.organiserId));
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export async function listEventsForReview(
  query: AdminEventsQuery,
): Promise<Paginated<OrganiserEvent>> {
  const skip = (query.page - 1) * query.limit;
  const [events, total] = await Promise.all([
    EventModel.find({ status: query.status })
      .sort({ updatedAt: 1 })
      .skip(skip)
      .limit(query.limit)
      .lean(),
    EventModel.countDocuments({ status: query.status }),
  ]);
  const byEvent = groupByEvent(await tiersFor(events.map((e) => e._id)));
  const organisers = await UserModel.find({ _id: { $in: events.map((e) => e.organiserId) } })
    .select('name')
    .lean();
  const names = new Map(organisers.map((o) => [o._id.toString(), o.name]));

  return paginate(
    events.map((e) =>
      toOrganiserEvent(
        e,
        byEvent.get(e._id.toString()) ?? [],
        names.get(e.organiserId.toString()) ?? 'Unknown',
      ),
    ),
    query.page,
    query.limit,
    total,
  );
}

export async function approveEvent(auth: AuthContext, eventId: string): Promise<OrganiserEvent> {
  const updated = await EventModel.updateOne(
    { _id: eventId, status: 'pending', startsAt: { $gt: new Date() } },
    { $set: { status: 'published', publishedAt: new Date(), rejectionReason: null } },
  );
  if (updated.matchedCount === 0) {
    if (!(await EventModel.exists({ _id: eventId }))) throw AppError.notFound('Event not found');
    throw AppError.conflict('Only a pending event that has not started can be approved');
  }
  return getOrganiserEvent(auth, eventId);
}

export async function rejectEvent(
  auth: AuthContext,
  eventId: string,
  reason: string,
): Promise<OrganiserEvent> {
  const updated = await EventModel.updateOne(
    { _id: eventId, status: 'pending' },
    { $set: { status: 'draft', rejectionReason: reason } },
  );
  if (updated.matchedCount === 0) {
    if (!(await EventModel.exists({ _id: eventId }))) throw AppError.notFound('Event not found');
    throw AppError.conflict('Only a pending event can be rejected');
  }
  return getOrganiserEvent(auth, eventId);
}
