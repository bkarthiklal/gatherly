/**
 * Demo data: an admin, organisers, attendees, and events in every state,
 * with real purchases made through the same code paths as production (so
 * holds, orders, tickets, analytics and check-ins are all consistent).
 *
 * Usage:  pnpm --filter @gatherly/api seed            (adds to an empty database)
 *         pnpm --filter @gatherly/api seed --reset    (wipes Gatherly collections first)
 *
 * Refuses to run against NODE_ENV=production unless --i-know-this-is-production.
 * Every account's password is SEED_PASSWORD (default below).
 */
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    reset: { type: 'boolean', default: false },
    'i-know-this-is-production': { type: 'boolean', default: false },
  },
});

const PASSWORD = process.env.SEED_PASSWORD ?? 'gatherly-demo-2026';

const { env, isProduction } = await import('../src/config/env.js');
if (isProduction && !args['i-know-this-is-production']) {
  console.error(
    'Refusing to seed a production database. Pass --i-know-this-is-production to override.',
  );
  process.exit(1);
}

const mongoose = (await import('mongoose')).default;
const { connectDb, disconnectDb } = await import('../src/lib/db.js');
const { closeRedis } = await import('../src/lib/redis.js');
const { hashPassword } = await import('../src/lib/password.js');
const { UserModel } = await import('../src/models/user.model.js');
const { PromoCodeModel } = await import('../src/models/promo-code.model.js');
const { TicketModel } = await import('../src/models/ticket.model.js');
const events = await import('../src/services/event.service.js');
const { reserveSeats } = await import('../src/services/inventory.service.js');
const { createOrder } = await import('../src/services/order.service.js');
const { confirmPayment } = await import('../src/services/payment.service.js');
const { checkIn } = await import('../src/services/checkin.service.js');

await connectDb(env.MONGODB_URI);
await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

if (args.reset) {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
  console.log('Cleared existing data');
} else if (await UserModel.exists({ email: 'admin@gatherly.dev' })) {
  console.error('Seed data already present. Re-run with --reset to start over.');
  await disconnectDb();
  await closeRedis();
  process.exit(1);
}

const hash = await hashPassword(PASSWORD);
async function user(name: string, email: string, role: 'attendee' | 'organiser' | 'admin') {
  const u = await UserModel.create({
    name,
    email,
    passwordHash: hash,
    role,
    emailVerifiedAt: new Date(),
  });
  return { userId: u._id.toString(), role };
}

const admin = await user('Aditi Admin', 'admin@gatherly.dev', 'admin');
const meera = await user('Meera Kapoor', 'meera@gatherly.dev', 'organiser');
const rahul = await user('Rahul Menon', 'rahul@gatherly.dev', 'organiser');
const attendees = await Promise.all(
  [
    ['Ananya Iyer', 'ananya@gatherly.dev'],
    ['Arjun Rao', 'arjun@gatherly.dev'],
    ['Zoya Sheikh', 'zoya@gatherly.dev'],
    ['Vikram Singh', 'vikram@gatherly.dev'],
    ['Nisha Patel', 'nisha@gatherly.dev'],
    ['Dev Malhotra', 'dev@gatherly.dev'],
  ].map(([n, e]) => user(n!, e!, 'attendee')),
);

const DAY = 24 * 60 * 60 * 1000;
function at(daysFromNow: number, hour: number, durationHours = 3) {
  const start = new Date(Date.now() + daysFromNow * DAY);
  start.setUTCHours(hour - 5, 30, 0, 0); // hour is IST (UTC+5:30)
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + durationHours * 3_600_000).toISOString(),
  };
}

interface Tier {
  name: string;
  priceMinor: number;
  quantityTotal: number;
  perUserLimit?: number;
}
interface Spec {
  organiser: typeof meera;
  title: string;
  description: string;
  category: 'music' | 'tech' | 'sports' | 'arts' | 'community' | 'education' | 'other';
  venue: { name: string; addressLine: string; city: string; coordinates?: [number, number] };
  when: { startsAt: string; endsAt: string };
  tiers: Tier[];
  state: 'published' | 'pending' | 'draft';
}

const specs: Spec[] = [
  {
    organiser: meera,
    title: 'Indiranagar Indie Nights',
    description:
      'Four independent bands from Bengaluru’s growing indie scene, one intimate stage. Doors open at 7 PM; the first set starts at 7:45. Food trucks outside, all ages welcome.',
    category: 'music',
    venue: {
      name: 'The Humming Tree',
      addressLine: '12th Main, Indiranagar',
      city: 'Bengaluru',
      coordinates: [77.6408, 12.9719],
    },
    when: at(9, 19, 4),
    tiers: [
      { name: 'Early Bird', priceMinor: 49_900, quantityTotal: 60, perUserLimit: 4 },
      { name: 'General', priceMinor: 79_900, quantityTotal: 180, perUserLimit: 6 },
      { name: 'Front Row', priceMinor: 149_900, quantityTotal: 20, perUserLimit: 2 },
    ],
    state: 'published',
  },
  {
    organiser: rahul,
    title: 'ReactConf Pune 2026',
    description:
      'A one-day conference on modern React: Server Components in production, the React Compiler, and design systems at scale. Twelve talks, two workshops, and lunch included with every ticket.',
    category: 'tech',
    venue: {
      name: 'Hyatt Pune',
      addressLine: 'Kalyani Nagar',
      city: 'Pune',
      coordinates: [73.9022, 18.5485],
    },
    when: at(21, 9, 9),
    tiers: [
      { name: 'Student', priceMinor: 99_900, quantityTotal: 80, perUserLimit: 1 },
      { name: 'Professional', priceMinor: 299_900, quantityTotal: 300, perUserLimit: 5 },
    ],
    state: 'published',
  },
  {
    organiser: meera,
    title: 'Sunday Morning 10K — Marine Drive',
    description:
      'A flat, fast 10K along the Queen’s Necklace at sunrise. Timing chips, hydration stations every 2.5 km, a finisher medal and breakfast at the end. Proceeds support the Mumbai coastal clean-up.',
    category: 'sports',
    venue: {
      name: 'Marine Drive Promenade',
      addressLine: 'Netaji Subhash Chandra Bose Road',
      city: 'Mumbai',
      coordinates: [72.8235, 18.9432],
    },
    when: at(14, 6, 3),
    tiers: [{ name: 'Runner', priceMinor: 120_000, quantityTotal: 500, perUserLimit: 4 }],
    state: 'published',
  },
  {
    organiser: rahul,
    title: 'Clay & Coffee: Beginner Pottery Workshop',
    description:
      'Three hours at the wheel with a studio potter. You will throw two pieces, glaze one, and collect it fired a week later. All materials, aprons and unlimited filter coffee included. Maximum twelve people.',
    category: 'arts',
    venue: {
      name: 'Kumbha Studio',
      addressLine: 'Jubilee Hills Road No. 36',
      city: 'Hyderabad',
      coordinates: [78.4074, 17.4326],
    },
    when: at(6, 11, 3),
    tiers: [{ name: 'Seat at the wheel', priceMinor: 250_000, quantityTotal: 12, perUserLimit: 2 }],
    state: 'published',
  },
  {
    organiser: meera,
    title: 'Neighbourhood Book Swap',
    description:
      'Bring a book, take a book. A free community afternoon for readers of every age, with a children’s reading corner and a short talk from a local author at 4 PM. Registration helps us plan seating.',
    category: 'community',
    venue: {
      name: 'Lodhi Garden Pavilion',
      addressLine: 'Lodhi Road',
      city: 'Delhi',
      coordinates: [77.2197, 28.5931],
    },
    when: at(4, 15, 3),
    tiers: [{ name: 'Free entry', priceMinor: 0, quantityTotal: 150, perUserLimit: 4 }],
    state: 'published',
  },
  {
    organiser: rahul,
    title: 'Data Science Bootcamp: Weekend Intensive',
    description:
      'Two days of hands-on Python for data analysis: pandas, visualisation, and your first machine-learning model, taught through real Indian public datasets. Bring a laptop; notebooks are provided.',
    category: 'education',
    venue: {
      name: 'WeWork Galaxy',
      addressLine: 'Residency Road',
      city: 'Bengaluru',
      coordinates: [77.6033, 12.9667],
    },
    when: at(30, 10, 8),
    tiers: [{ name: 'Weekend pass', priceMinor: 450_000, quantityTotal: 40, perUserLimit: 2 }],
    state: 'published',
  },
  {
    organiser: meera,
    title: 'Monsoon Jazz on the Terrace',
    description:
      'Live jazz quartet under the covered rooftop as the rain comes in. Standards, bossa nova and a few originals. Table seating; food and drinks available to order.',
    category: 'music',
    venue: {
      name: 'Skyline Terrace',
      addressLine: 'Bandra West',
      city: 'Mumbai',
      coordinates: [72.8277, 19.0596],
    },
    when: at(18, 20, 3),
    tiers: [
      { name: 'Standing', priceMinor: 69_900, quantityTotal: 80 },
      { name: 'Table for two', priceMinor: 249_900, quantityTotal: 15, perUserLimit: 1 },
    ],
    state: 'pending',
  },
  {
    organiser: rahul,
    title: 'Startup Pitch Evening (Draft)',
    description:
      'Ten early-stage founders pitch to a panel of angel investors. Networking afterwards. Details still being finalised with the venue.',
    category: 'tech',
    venue: { name: 'TBC', addressLine: 'Koramangala', city: 'Bengaluru' },
    when: at(40, 18, 3),
    tiers: [{ name: 'Audience', priceMinor: 29_900, quantityTotal: 100 }],
    state: 'draft',
  },
];

const created: { spec: Spec; id: string; tierIds: string[] }[] = [];
for (const spec of specs) {
  const event = await events.createEvent(spec.organiser, {
    title: spec.title,
    description: spec.description,
    category: spec.category,
    venue: spec.venue,
    ...spec.when,
    tiers: spec.tiers.map((t) => ({
      ...t,
      currency: 'INR' as const,
      perUserLimit: t.perUserLimit ?? 10,
    })),
  });
  if (spec.state !== 'draft') await events.submitEvent(spec.organiser, event.id);
  if (spec.state === 'published') await events.approveEvent(admin, event.id);
  created.push({ spec, id: event.id, tierIds: event.tiers.map((t) => t.id) });
  console.log(`  ${spec.state.padEnd(9)} ${spec.title}`);
}

// Promo codes.
const indie = created[0]!;
const react = created[1]!;
await PromoCodeModel.create([
  { eventId: indie.id, code: 'INDIE20', type: 'percent', value: 20, maxUses: 50 },
  { eventId: react.id, code: 'STUDENT500', type: 'fixed', value: 50_000, maxUses: 30 },
  { eventId: react.id, code: 'SPEAKER', type: 'percent', value: 100, maxUses: 12 },
]);

// Purchases through the real reservation → order → payment path.
async function buy(
  buyer: (typeof attendees)[number],
  eventIdx: number,
  tierIdx: number,
  quantity: number,
  promoCode?: string,
) {
  const target = created[eventIdx]!;
  const hold = await reserveSeats(buyer, { tierId: target.tierIds[tierIdx]!, quantity });
  const order = await createOrder(buyer, {
    holdIds: [hold.id],
    ...(promoCode ? { promoCode } : {}),
  });
  await confirmPayment(order.id, {
    paymentId: `pay_seed_${order.id}`,
    amountMinor: order.totalMinor,
    source: 'webhook',
  });
  return order;
}

const [ananya, arjun, zoya, vikram, nisha, dev] = attendees as [
  (typeof attendees)[number],
  (typeof attendees)[number],
  (typeof attendees)[number],
  (typeof attendees)[number],
  (typeof attendees)[number],
  (typeof attendees)[number],
];
await buy(ananya, 0, 0, 2);
await buy(arjun, 0, 1, 4, 'INDIE20');
await buy(zoya, 0, 2, 2);
await buy(vikram, 0, 1, 3);
await buy(nisha, 1, 1, 2);
await buy(dev, 1, 0, 1, 'STUDENT500');
await buy(ananya, 1, 1, 1);
await buy(arjun, 2, 0, 2);
await buy(zoya, 2, 0, 1);
await buy(vikram, 3, 0, 2);
await buy(nisha, 3, 0, 2);
await buy(dev, 3, 0, 2);
await buy(ananya, 4, 0, 3);
await buy(arjun, 5, 0, 1);

// Pottery (event 3) is nearly sold out — 6 of 12 left — good for showing live availability.
// A few people have already arrived at the book swap.
const swapTickets = await TicketModel.find({ eventId: created[4]!.id }).limit(2).lean();
for (const t of swapTickets) await checkIn(meera, created[4]!.id, { serial: t.serial });

console.log(`
Seeded ${specs.length} events, ${attendees.length + 3} users.
All passwords: ${PASSWORD}

  admin@gatherly.dev     admin
  meera@gatherly.dev     organiser (Indie Nights, 10K, Book Swap, Jazz)
  rahul@gatherly.dev     organiser (ReactConf, Pottery, Bootcamp, Pitch draft)
  ananya@gatherly.dev    attendee with tickets (+ arjun, zoya, vikram, nisha, dev)

Promo codes: INDIE20 (Indie Nights), STUDENT500 and SPEAKER (ReactConf)
`);

await disconnectDb();
await closeRedis();
