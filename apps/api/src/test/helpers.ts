import type { AuthResponse, UserRole } from '@gatherly/types';
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
