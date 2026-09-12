import type { EventAnalytics, OrganiserOverview } from '@gatherly/types';
import { Types } from 'mongoose';
import { assertCanManage, type AuthContext } from '../middleware/auth.js';
import { EventModel } from '../models/event.model.js';
import { OrderModel } from '../models/order.model.js';
import { TicketModel } from '../models/ticket.model.js';
import { TicketTierModel } from '../models/ticket-tier.model.js';

/**
 * Sales figures computed in the database with one aggregation pipeline
 * using $facet, so revenue, per-tier totals, daily sales and promo usage
 * come back in a single round trip over the event's orders.
 */
export async function eventAnalytics(auth: AuthContext, eventId: string): Promise<EventAnalytics> {
  const event = await EventModel.findById(eventId).select('organiserId').lean();
  assertCanManage(event?.organiserId, auth);
  const id = new Types.ObjectId(eventId);

  interface FacetResult {
    totals: { revenueMinor: number; ordersPaid: number }[];
    refunded: { refundedMinor: number }[];
    byTier: { _id: Types.ObjectId; revenueMinor: number }[];
    byDay: { _id: string; tickets: number; revenueMinor: number }[];
    promos: { _id: string; uses: number; discountMinor: number }[];
  }

  const [facets] = await OrderModel.aggregate<FacetResult>([
    { $match: { eventId: id, status: { $in: ['paid', 'refunded'] } } },
    {
      $facet: {
        totals: [
          { $match: { status: 'paid' } },
          { $group: { _id: null, revenueMinor: { $sum: '$totalMinor' }, ordersPaid: { $sum: 1 } } },
        ],
        refunded: [
          { $match: { status: 'refunded' } },
          { $group: { _id: null, refundedMinor: { $sum: '$totalMinor' } } },
        ],
        byTier: [
          { $match: { status: 'paid' } },
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.tierId',
              // Gross per tier; order-level discounts are reported separately under promo codes.
              revenueMinor: { $sum: { $multiply: ['$items.quantity', '$items.unitPriceMinor'] } },
            },
          },
        ],
        byDay: [
          { $match: { status: 'paid' } },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: 'Asia/Kolkata' },
              },
              tickets: { $sum: { $sum: '$items.quantity' } },
              revenueMinor: { $sum: '$totalMinor' },
            },
          },
          { $sort: { _id: 1 } },
        ],
        promos: [
          { $match: { status: 'paid', promoCode: { $ne: null } } },
          {
            $group: {
              _id: '$promoCode',
              uses: { $sum: 1 },
              discountMinor: { $sum: '$discountMinor' },
            },
          },
          { $sort: { uses: -1 } },
        ],
      },
    },
  ]);

  const [tiers, checkedIn] = await Promise.all([
    TicketTierModel.find({ eventId: id }).sort({ sortOrder: 1 }).lean(),
    TicketModel.countDocuments({ eventId: id, status: 'used' }),
  ]);
  const tierRevenue = new Map(
    (facets?.byTier ?? []).map((t) => [t._id.toString(), t.revenueMinor]),
  );

  return {
    eventId,
    revenueMinor: facets?.totals[0]?.revenueMinor ?? 0,
    refundedMinor: facets?.refunded[0]?.refundedMinor ?? 0,
    ordersPaid: facets?.totals[0]?.ordersPaid ?? 0,
    ticketsSold: tiers.reduce((n, t) => n + t.quantitySold, 0),
    capacity: tiers.reduce((n, t) => n + t.quantityTotal, 0),
    checkedIn,
    tiers: tiers.map((t) => ({
      tierId: t._id.toString(),
      name: t.name,
      sold: t.quantitySold,
      held: t.quantityHeld,
      capacity: t.quantityTotal,
      revenueMinor: tierRevenue.get(t._id.toString()) ?? 0,
    })),
    salesByDay: (facets?.byDay ?? []).map((d) => ({
      date: d._id,
      tickets: d.tickets,
      revenueMinor: d.revenueMinor,
    })),
    promoCodes: (facets?.promos ?? []).map((p) => ({
      code: p._id,
      uses: p.uses,
      discountMinor: p.discountMinor,
    })),
  };
}

export async function organiserOverview(auth: AuthContext): Promise<OrganiserOverview> {
  const organiserId = new Types.ObjectId(auth.userId);
  const events = await EventModel.find({ organiserId }).select('title status startsAt').lean();
  const eventIds = events.map((e) => e._id);

  const [revenue, tiers] = await Promise.all([
    OrderModel.aggregate<{ revenueMinor: number }>([
      { $match: { eventId: { $in: eventIds }, status: 'paid' } },
      { $group: { _id: null, revenueMinor: { $sum: '$totalMinor' } } },
    ]),
    TicketTierModel.aggregate<{ _id: Types.ObjectId; sold: number; capacity: number }>([
      { $match: { eventId: { $in: eventIds } } },
      {
        $group: {
          _id: '$eventId',
          sold: { $sum: '$quantitySold' },
          capacity: { $sum: '$quantityTotal' },
        },
      },
    ]),
  ]);
  const byEvent = new Map(tiers.map((t) => [t._id.toString(), t]));
  const now = new Date();

  return {
    events: events.length,
    published: events.filter((e) => e.status === 'published').length,
    revenueMinor: revenue[0]?.revenueMinor ?? 0,
    ticketsSold: tiers.reduce((n, t) => n + t.sold, 0),
    upcoming: events
      .filter((e) => e.status === 'published' && e.startsAt > now)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, 5)
      .map((e) => ({
        id: e._id.toString(),
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        sold: byEvent.get(e._id.toString())?.sold ?? 0,
        capacity: byEvent.get(e._id.toString())?.capacity ?? 0,
      })),
  };
}
