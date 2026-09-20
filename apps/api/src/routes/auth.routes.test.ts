import type { AuthResponse } from '@gatherly/types';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { REFRESH_COOKIE } from '../controllers/auth.controller.js';
import { UserModel } from '../models/user.model.js';
import { PASSWORD, app, bearer, registerViaApi, uniqueEmail } from '../test/helpers.js';

function refreshCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((c) => c.startsWith(`${REFRESH_COOKIE}=`))?.split(';')[0];
}

describe('POST /api/auth/register', () => {
  it('creates an attendee, returns an access token and sets an httpOnly refresh cookie', async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Asha', email, password: PASSWORD })
      .expect(201);

    const body = res.body as AuthResponse;
    expect(body.user).toMatchObject({
      name: 'Asha',
      email,
      role: 'attendee',
      emailVerified: false,
    });
    expect(body.accessToken).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain('passwordHash');

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(REFRESH_COOKIE),
    );
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('stores an Argon2id hash, never the password', async () => {
    const { user } = await registerViaApi();
    const stored = await UserModel.findById(user.id).select('+passwordHash').lean();
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(stored?.passwordHash).not.toContain(PASSWORD);
  });

  it('normalises email case and whitespace before storing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ravi', email: '  Ravi.Kumar@Example.COM ', password: PASSWORD })
      .expect(201);
    expect((res.body as AuthResponse).user.email).toBe('ravi.kumar@example.com');
  });

  it('rejects a duplicate email with 409, including a differently-cased one', async () => {
    const email = uniqueEmail();
    await registerViaApi({ email });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Dupe', email: email.toUpperCase(), password: PASSWORD })
      .expect(409);
    expect(res.body).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('rejects a password shorter than 15 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Short', email: uniqueEmail(), password: 'short' })
      .expect(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('refuses self-registration as admin and creates no account', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Mallory', email, password: PASSWORD, role: 'admin' })
      .expect(400);
    expect(await UserModel.countDocuments({ email })).toBe(0);
  });

  it('allows self-registration as organiser', async () => {
    const { user } = await registerViaApi({ role: 'organiser' });
    expect(user.role).toBe('organiser');
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const email = uniqueEmail();
    await registerViaApi({ email });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    expect((res.body as AuthResponse).user.email).toBe(email);
    expect(refreshCookie(res)).toBeDefined();
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const email = uniqueEmail();
    await registerViaApi({ email });
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'not-the-password!' })
      .expect(401);
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail('ghost'), password: PASSWORD })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rejects a NoSQL operator in place of the email', async () => {
    await registerViaApi();
    await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: null }, password: PASSWORD })
      .expect(400);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a token', async () => {
    await request(app).get('/api/auth/me').expect(401);
  });

  it('returns 401 for a tampered token', async () => {
    const { accessToken } = await registerViaApi();
    await request(app)
      .get('/api/auth/me')
      .set(...bearer(`${accessToken.slice(0, -2)}xx`))
      .expect(401);
  });

  it('returns the current user for a valid token', async () => {
    const { accessToken, user } = await registerViaApi();
    const res = await request(app)
      .get('/api/auth/me')
      .set(...bearer(accessToken))
      .expect(200);
    expect(res.body).toEqual({ user });
  });
});

describe('refresh token rotation', () => {
  it('issues a new refresh token and access token on refresh', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/register')
      .send({ name: 'Rot', email: uniqueEmail(), password: PASSWORD })
      .expect(201);

    const res = await agent.post('/api/auth/refresh').expect(200);
    expect((res.body as AuthResponse).accessToken).toEqual(expect.any(String));
    expect(refreshCookie(res)).toBeDefined();
  });

  it('treats reuse of a rotated token as theft and revokes the whole session family', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Victim', email: uniqueEmail(), password: PASSWORD })
      .expect(201);
    const original = refreshCookie(reg)!;

    // Legitimate rotation.
    const rotated = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', original)
      .expect(200);
    const current = refreshCookie(rotated)!;

    // The stolen, already-used token is replayed.
    await request(app).post('/api/auth/refresh').set('Cookie', original).expect(401);

    // The legitimate holder's newer token is now dead too.
    await request(app).post('/api/auth/refresh').set('Cookie', current).expect(401);
  });

  it('lets exactly one of two concurrent refreshes with the same token succeed', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Race', email: uniqueEmail(), password: PASSWORD })
      .expect(201);
    const token = refreshCookie(reg)!;

    const results = await Promise.all([
      request(app).post('/api/auth/refresh').set('Cookie', token),
      request(app).post('/api/auth/refresh').set('Cookie', token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('returns 401 with no cookie', async () => {
    await request(app).post('/api/auth/refresh').expect(401);
  });

  it('keeps separate devices logged in independently', async () => {
    const email = uniqueEmail();
    await registerViaApi({ email });
    const laptop = refreshCookie(
      await request(app).post('/api/auth/login').send({ email, password: PASSWORD }),
    )!;
    const phone = refreshCookie(
      await request(app).post('/api/auth/login').send({ email, password: PASSWORD }),
    )!;

    await request(app).post('/api/auth/refresh').set('Cookie', laptop).expect(200);
    await request(app).post('/api/auth/refresh').set('Cookie', phone).expect(200);
  });
});

describe('logout', () => {
  it('revokes the refresh token', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bye', email: uniqueEmail(), password: PASSWORD })
      .expect(201);
    const token = refreshCookie(reg)!;

    await request(app).post('/api/auth/logout').set('Cookie', token).expect(204);
    await request(app).post('/api/auth/refresh').set('Cookie', token).expect(401);
  });

  it('logout-all invalidates existing access tokens and every refresh token', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Everywhere', email: uniqueEmail(), password: PASSWORD })
      .expect(201);
    const { accessToken } = reg.body as AuthResponse;
    const token = refreshCookie(reg)!;

    await request(app)
      .post('/api/auth/logout-all')
      .set(...bearer(accessToken))
      .expect(204);
    await request(app)
      .get('/api/auth/me')
      .set(...bearer(accessToken))
      .expect(401);
    await request(app).post('/api/auth/refresh').set('Cookie', token).expect(401);
  });
});
