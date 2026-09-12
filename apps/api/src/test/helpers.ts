import type { AuthResponse, OrganiserEvent, UserRole } from '@gatherly/types';
import request from 'supertest';
import { createApp } from '../app.js';
import { hashPassword } from '../lib/password.js';
import { UserModel } from '../models/user.model.js';
import { signAccessToken } from '../services/token.service.js';

export const app = createApp();

let counter = 0;

export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}${counter}_${Date.now()}@example.com`;
}

export const PASSWORD = 'correct-horse-battery';

export async function registerViaApi(
  overrides: Partial<{
    name: string;
    email: string;
    password: string;
    role: 'attendee' | 'organiser';
  }> = {},
): Promise<AuthResponse> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email: uniqueEmail(), password: PASSWORD, ...overrides })
    .expect(201);
  return res.body as AuthResponse;
}

/** Inserts a user directly — the only way to create an admin, mirroring production. */
export async function createUser(
  role: UserRole,
  name = `${role} user`,
): Promise<{ id: string; token: string }> {
  const user = await UserModel.create({
    name,
    email: uniqueEmail(role),
    passwordHash: await hashPassword(PASSWORD),
    role,
  });
  const id = user._id.toString();
  return { id, token: signAccessToken({ id, role, tokenVersion: user.tokenVersion }) };
}

export function bearer(token: string): [string, string] {
  return ['Authorization', `Bearer ${token}`];
}

const DAY = 24 * 60 * 60 * 1000;

export function eventPayload(overrides: Record<string, unknown> = {}) {
  const startsAt = new Date(Date.now() + 30 * DAY);
  return {
    title: 'Indie Music Night',
    description: 'An evening of independent artists from across the city, all ages welcome.',
    category: 'music',
    venue: {
      name: 'The Blue Hall',
      addressLine: '12 MG Road',
      city: 'Bengaluru',
      coordinates: [77.6, 12.97],
    },
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000).toISOString(),
    tiers: [
      { name: 'General', priceMinor: 49_900, quantityTotal: 100, perUserLimit: 4 },
      { name: 'VIP', priceMinor: 149_900, quantityTotal: 20, perUserLimit: 2 },
    ],
    ...overrides,
  };
}

/** Creates an event as the organiser and walks it to `published` through the real endpoints. */
export async function publishedEvent(
  organiserToken: string,
  adminToken: string,
  overrides: Record<string, unknown> = {},
): Promise<OrganiserEvent> {
  const created = await request(app)
    .post('/api/organiser/events')
    .set(...bearer(organiserToken))
    .send(eventPayload(overrides))
    .expect(201);
  const id = (created.body as { id: string }).id;
  await request(app)
    .post(`/api/organiser/events/${id}/submit`)
    .set(...bearer(organiserToken))
    .expect(200);
  const approved = await request(app)
    .post(`/api/admin/events/${id}/approve`)
    .set(...bearer(adminToken))
    .expect(200);
  return approved.body as OrganiserEvent;
}
