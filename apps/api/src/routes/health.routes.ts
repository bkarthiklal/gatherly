import { Router } from 'express';
import { dbState } from '../lib/db.js';

export const healthRouter: Router = Router();

/**
 * Liveness and readiness in one probe. Render polls this to decide whether a
 * new deploy may receive traffic, so it answers 503 until the database is
 * reachable — routing users to an instance that cannot read data is worse
 * than a slightly slower rollout.
 */
healthRouter.get('/healthz', (_req, res) => {
  const db = dbState();
  const healthy = db === 'connected';
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    dbState: db,
    uptimeSeconds: Math.round(process.uptime()),
  });
});
