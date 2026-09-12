import { createHash } from 'node:crypto';
import type {
  EventDetail,
  EventSummary,
  OrganiserEvent,
  Paginated,
  UploadSignature,
} from '@gatherly/types';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { TicketTierModel } from '../models/ticket-tier.model.js';
import { app, bearer, createUser, eventPayload, publishedEvent } from '../test/helpers.js';

let organiser: { id: string; token: string };
let otherOrganiser: { id: string; token: string };
let attendee: { id: string; token: string };
let admin: { id: string; token: string };

beforeEach(async () => {
  [organiser, otherOrganiser, attendee, admin] = await Promise.all([
    createUser('organiser', 'Olivia Organiser'),
    createUser('organiser', 'Oscar Other'),
    createUser('attendee'),
    createUser('admin'),
  ]);
});

async function createDraft(token = organiser.token, overrides = {}): Promise<OrganiserEvent> {
  const res = await request(app)
    .post('/api/organiser/events')
    .set(...bearer(token))
    .send(eventPayload(overrides))
    .expect(201);
  return res.body as OrganiserEvent;
}

describe('organiser event management', () => {
  it('creates a draft with tiers, a slug and derived availability', async () => {
    const event = await createDraft();
    expect(event.status).toBe('draft');
    expect(event.slug).toMatch(/^indie-music-night-[0-9a-f]{6}$/);
    expect(event.organiser).toEqual({ id: organiser.id, name: 'Olivia Organiser' });
    expect(event.tiers).toHaveLength(2);
    expect(event.tiers[0]).toMatchObject({
      name: 'General',
      quantityAvailable: 100,
      quantitySold: 0,
      onSale: true,
    });
    expect(event.fromPriceMinor).toBe(49_900);
    expect(event.venue.coordinates).toEqual([77.6, 12.97]);
  });

  it('forbids attendees from creating events', async () => {
    await request(app)
      .post('/api/organiser/events')
      .set(...bearer(attendee.token))
      .send(eventPayload())
      .expect(403);
  });

  it('rejects an event that starts in the past', async () => {
    await request(app)
      .post('/api/organiser/events')
      .set(...bearer(organiser.token))
      .send(eventPayload({ startsAt: new Date(Date.now() - 1000).toISOString() }))
      .expect(400);
  });

  it("returns 404 when an organiser touches another organiser's event", async () => {
    const event = await createDraft();
    await request(app)
      .get(`/api/organiser/events/${event.id}`)
      .set(...bearer(otherOrganiser.token))
      .expect(404);
    await request(app)
      .patch(`/api/organiser/events/${event.id}`)
      .set(...bearer(otherOrganiser.token))
      .send({ title: 'Hijacked title' })
      .expect(404);
    await request(app)
      .delete(`/api/organiser/events/${event.id}`)
      .set(...bearer(otherOrganiser.token))
      .expect(404);
  });

  it('lists only the caller’s own events', async () => {
    await createDraft();
    await createDraft(otherOrganiser.token);
    const res = await request(app)
      .get('/api/organiser/events')
      .set(...bearer(organiser.token))
      .expect(200);
    const items = (res.body as { items: OrganiserEvent[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.organiser.id).toBe(organiser.id);
  });

  it('allows structural edits on a draft but not after submission', async () => {
    const event = await createDraft();
    await request(app)
      .patch(`/api/organiser/events/${event.id}`)
      .set(...bearer(organiser.token))
      .send({ category: 'tech' })
      .expect(200);

    await request(app)
      .post(`/api/organiser/events/${event.id}/submit`)
      .set(...bearer(organiser.token))
      .expect(200);
    await request(app)
      .patch(`/api/organiser/events/${event.id}`)
      .set(...bearer(organiser.token))
      .send({ category: 'arts' })
      .expect(409);
    await request(app)
      .patch(`/api/organiser/events/${event.id}`)
      .set(...bearer(organiser.token))
      .send({ description: 'Updated description with enough characters to pass.' })
      .expect(200);
  });

  it('refuses to shrink capacity below tickets already sold or held', async () => {
    const event = await createDraft();
    const tier = event.tiers[0]!;
    await TicketTierModel.updateOne({ _id: tier.id }, { quantitySold: 60, quantityHeld: 10 });

    await request(app)
      .patch(`/api/organiser/events/${event.id}/tiers/${tier.id}`)
      .set(...bearer(organiser.token))
      .send({ quantityTotal: 69 })
      .expect(409);
    const ok = await request(app)
      .patch(`/api/organiser/events/${event.id}/tiers/${tier.id}`)
      .set(...bearer(organiser.token))
      .send({ quantityTotal: 70 })
      .expect(200);
    expect((ok.body as OrganiserEvent).tiers[0]!.quantityAvailable).toBe(0);
  });

  it('deletes a draft but not an event with ticket activity', async () => {
    const clean = await createDraft();
    await request(app)
      .delete(`/api/organiser/events/${clean.id}`)
      .set(...bearer(organiser.token))
      .expect(204);

    const busy = await createDraft();
    await TicketTierModel.updateOne({ _id: busy.tiers[0]!.id }, { quantityHeld: 1 });
    await request(app)
      .delete(`/api/organiser/events/${busy.id}`)
      .set(...bearer(organiser.token))
      .expect(409);
  });

  it('adds and removes tiers, keeping at least one', async () => {
    const event = await createDraft(organiser.token, {
      tiers: [{ name: 'Only', priceMinor: 0, quantityTotal: 10 }],
    });
    await request(app)
      .delete(`/api/organiser/events/${event.id}/tiers/${event.tiers[0]!.id}`)
      .set(...bearer(organiser.token))
      .expect(409);

    const added = await request(app)
      .post(`/api/organiser/events/${event.id}/tiers`)
      .set(...bearer(organiser.token))
      .send({ name: 'Early bird', priceMinor: 19_900, quantityTotal: 50 })
      .expect(201);
    expect((added.body as OrganiserEvent).tiers).toHaveLength(2);
  });

  it('cancels an event once', async () => {
    const event = await createDraft();
    const res = await request(app)
      .post(`/api/organiser/events/${event.id}/cancel`)
      .set(...bearer(organiser.token))
      .expect(200);
    expect((res.body as OrganiserEvent).status).toBe('cancelled');
    await request(app)
      .post(`/api/organiser/events/${event.id}/cancel`)
      .set(...bearer(organiser.token))
      .expect(409);
  });
});

describe('admin moderation', () => {
  it('moves draft → pending → published', async () => {
    const event = await publishedEvent(organiser.token, admin.token);
    expect(event.status).toBe('published');
  });

  it('cannot approve a draft that was never submitted', async () => {
    const event = await createDraft();
    await request(app)
      .post(`/api/admin/events/${event.id}/approve`)
      .set(...bearer(admin.token))
      .expect(409);
  });

  it('rejects back to draft with a reason the organiser can see', async () => {
    const event = await createDraft();
    await request(app)
      .post(`/api/organiser/events/${event.id}/submit`)
      .set(...bearer(organiser.token))
      .expect(200);
    await request(app)
      .post(`/api/admin/events/${event.id}/reject`)
      .set(...bearer(admin.token))
      .send({ reason: 'Please add a real venue address.' })
      .expect(200);

    const mine = await request(app)
      .get(`/api/organiser/events/${event.id}`)
      .set(...bearer(organiser.token))
      .expect(200);
    expect(mine.body).toMatchObject({
      status: 'draft',
      rejectionReason: 'Please add a real venue address.',
    });
  });

  it('lists pending events for review', async () => {
    const event = await createDraft();
    await request(app)
      .post(`/api/organiser/events/${event.id}/submit`)
      .set(...bearer(organiser.token))
      .expect(200);
    const res = await request(app)
      .get('/api/admin/events?status=pending')
      .set(...bearer(admin.token))
      .expect(200);
    expect((res.body as Paginated<OrganiserEvent>).items.map((e) => e.id)).toEqual([event.id]);
  });

  it('is forbidden to organisers', async () => {
    await request(app)
      .get('/api/admin/events')
      .set(...bearer(organiser.token))
      .expect(403);
  });
});

describe('public browsing', () => {
  it('shows only published events and hides drafts and pending ones', async () => {
    const live = await publishedEvent(organiser.token, admin.token);
    const draft = await createDraft();

    const list = await request(app).get('/api/events').expect(200);
    const ids = (list.body as Paginated<EventSummary>).items.map((e) => e.id);
    expect(ids).toEqual([live.id]);

    await request(app).get(`/api/events/${draft.slug}`).expect(404);
    const detail = await request(app).get(`/api/events/${live.slug}`).expect(200);
    expect((detail.body as EventDetail).tiers).toHaveLength(2);
  });

  it('filters by category and city (case-insensitive) and paginates', async () => {
    await publishedEvent(organiser.token, admin.token, { category: 'tech', title: 'Tech Summit' });
    await publishedEvent(organiser.token, admin.token, {
      title: 'Mumbai Jazz',
      venue: { name: 'Hall', addressLine: '1 Marine Drive', city: 'Mumbai' },
    });

    const tech = await request(app).get('/api/events?category=tech').expect(200);
    expect((tech.body as Paginated<EventSummary>).items.map((e) => e.title)).toEqual([
      'Tech Summit',
    ]);

    const mumbai = await request(app).get('/api/events?city=MUMBAI').expect(200);
    expect((mumbai.body as Paginated<EventSummary>).items.map((e) => e.title)).toEqual([
      'Mumbai Jazz',
    ]);

    const page = await request(app).get('/api/events?limit=1&page=2').expect(200);
    expect(page.body).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 });
  });

  it('searches titles and descriptions by keyword', async () => {
    await publishedEvent(organiser.token, admin.token, { title: 'Startup Pitch Evening' });
    await publishedEvent(organiser.token, admin.token, { title: 'Classical Recital' });
    const res = await request(app).get('/api/events?q=pitch').expect(200);
    expect((res.body as Paginated<EventSummary>).items.map((e) => e.title)).toEqual([
      'Startup Pitch Evening',
    ]);
  });

  it('never turns bracket syntax in the query string into a MongoDB operator', async () => {
    await publishedEvent(organiser.token, admin.token, { category: 'music', title: 'Music One' });
    await publishedEvent(organiser.token, admin.token, { category: 'tech', title: 'Tech One' });

    // Were `category[$ne]=music` parsed into { $ne: 'music' }, only the tech event would return.
    // Express 5's simple query parser keeps it as a literal key, which the schema then discards.
    const res = await request(app).get('/api/events?category[$ne]=music').expect(200);
    expect((res.body as Paginated<EventSummary>).items.map((e) => e.title).sort()).toEqual([
      'Music One',
      'Tech One',
    ]);
  });
});

describe('banner upload signature', () => {
  it('answers 503 when Cloudinary is not configured', async () => {
    await request(app)
      .post('/api/organiser/uploads/banner-signature')
      .set(...bearer(organiser.token))
      .expect(503);
  });

  it('signs folder, formats and timestamp with the API secret', async () => {
    const mutableEnv = env;
    Object.assign(mutableEnv, {
      CLOUDINARY_CLOUD_NAME: 'demo-cloud',
      CLOUDINARY_API_KEY: '123456',
      CLOUDINARY_API_SECRET: 'shh-secret',
    });
    try {
      const res = await request(app)
        .post('/api/organiser/uploads/banner-signature')
        .set(...bearer(organiser.token))
        .expect(200);
      const sig = res.body as UploadSignature;
      const expected = createHash('sha1')
        .update(
          `allowed_formats=${sig.allowedFormats}&folder=${sig.folder}&timestamp=${sig.timestamp}shh-secret`,
        )
        .digest('hex');
      expect(sig.signature).toBe(expected);
      expect(JSON.stringify(sig)).not.toContain('shh-secret');
    } finally {
      Object.assign(mutableEnv, {
        CLOUDINARY_CLOUD_NAME: undefined,
        CLOUDINARY_API_KEY: undefined,
        CLOUDINARY_API_SECRET: undefined,
      });
    }
  });
});
