import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test as base, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

const MONGODB_URI =
  process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/gatherly?replicaSet=rs0';

let client: MongoClient | undefined;
async function db() {
  client ??= await new MongoClient(MONGODB_URI).connect();
  return client.db();
}

/**
 * Signs a seeded user in without a password: writes a refresh session
 * straight into the development database and hands the browser the matching
 * httpOnly cookie. On load the app exchanges it for an access token exactly
 * as it would after a real sign-in, so everything downstream is unchanged.
 */
async function signInAs(page: Page, email: string): Promise<void> {
  const user = await (await db()).collection('users').findOne({ email });
  if (!user) throw new Error(`Seed user ${email} not found — run the seed script first`);

  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await (await db()).collection('sessions').insertOne({
    userId: user._id,
    familyId: randomUUID(),
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    revokedAt: null,
    userAgent: 'playwright',
    ip: null,
    createdAt: now,
  });

  const url = new URL(test.info().project.use.baseURL ?? 'http://localhost:5173');
  await page.context().addCookies([
    {
      name: 'gatherly_rt',
      value: token,
      domain: url.hostname,
      path: '/api/auth',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${process.env.E2E_API_URL ?? 'http://localhost:4000'}/api${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export const test = base.extend<{ signInAs: (email: string) => Promise<void> }>({
  signInAs: async ({ page }, use) => {
    await use((email) => signInAs(page, email));
  },
  // Any uncaught exception in the page fails the test, even if the UI looked fine.
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await use(page);
    expect(errors, `Uncaught errors in the page:\n${errors.join('\n')}`).toEqual([]);
  },
});

test.afterAll(async () => {
  await client?.close();
  client = undefined;
});

export { expect };
