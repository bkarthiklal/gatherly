import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './error-handler.js';
import { assertCanManage, getAuth, requireAuth, requireRole } from './auth.js';
import { bearer, createUser } from '../test/helpers.js';

function appWith(...handlers: express.RequestHandler[]): Express {
  const app = express();
  app.get('/probe', ...handlers, (req, res) => {
    res.json(getAuth(req));
  });
  app.use(errorHandler);
  return app;
}

describe('requireRole', () => {
  const app = appWith(requireAuth, requireRole('organiser', 'admin'));

  it('allows a listed role', async () => {
    const organiser = await createUser('organiser');
    await request(app)
      .get('/probe')
      .set(...bearer(organiser.token))
      .expect(200);
  });

  it('forbids an unlisted role with 403', async () => {
    const attendee = await createUser('attendee');
    await request(app)
      .get('/probe')
      .set(...bearer(attendee.token))
      .expect(403);
  });

  it('uses the role stored in the database, not the one in the token', async () => {
    const { UserModel } = await import('../models/user.model.js');
    const organiser = await createUser('organiser');
    await UserModel.updateOne({ _id: organiser.id }, { role: 'attendee' });
    await request(app)
      .get('/probe')
      .set(...bearer(organiser.token))
      .expect(403);
  });
});

describe('assertCanManage', () => {
  it('lets the owner through', () => {
    expect(() => assertCanManage('abc', { userId: 'abc', role: 'organiser' })).not.toThrow();
  });

  it("hides another organiser's resource as 404 rather than 403", () => {
    expect(() => assertCanManage('owner-a', { userId: 'owner-b', role: 'organiser' })).toThrow(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it('lets an admin manage anything', () => {
    expect(() => assertCanManage('someone', { userId: 'admin', role: 'admin' })).not.toThrow();
  });
});
