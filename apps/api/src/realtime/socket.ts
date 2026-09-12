import type { Server as HttpServer } from 'node:http';
import { SOCKET_EVENTS, type AvailabilityUpdate, type CheckInStats } from '@gatherly/types';
import { Types } from 'mongoose';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import { subscribe } from '../lib/domain-events.js';
import { logger } from '../lib/logger.js';
import { assertCanManage, type AuthContext } from '../middleware/auth.js';
import { EventModel } from '../models/event.model.js';
import { TicketTierModel, isOnSale, quantityAvailable } from '../models/ticket-tier.model.js';
import { checkInStats } from '../services/checkin.service.js';
import { verifyAccessToken } from '../services/token.service.js';

type Ack = (response: { ok: true; data?: unknown } | { ok: false; error: string }) => void;

interface SocketData {
  auth: AuthContext | null;
}

const MAX_ROOMS_PER_SOCKET = 20;
/** Bursts of purchases within this window become one broadcast per event. */
const COALESCE_MS = 200;

const eventRoom = (id: string) => `event:${id}`;
const organiserRoom = (id: string) => `organiser:${id}`;

async function availabilityFor(eventId: string): Promise<AvailabilityUpdate> {
  const now = new Date();
  const tiers = await TicketTierModel.find({ eventId }).sort({ sortOrder: 1 }).lean();
  return {
    eventId,
    tiers: tiers.map((t) => ({
      id: t._id.toString(),
      quantityAvailable: quantityAvailable(t),
      onSale: isOnSale(t, now),
    })),
  };
}

/** Collapses many triggers for the same key into one call after a short delay. */
function coalesce(delayMs: number, run: (key: string) => Promise<void>): (key: string) => void {
  const pending = new Map<string, NodeJS.Timeout>();
  return (key) => {
    if (pending.has(key)) return;
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        run(key).catch((err: unknown) => logger.error({ err, key }, 'Realtime broadcast failed'));
      }, delayMs),
    );
  };
}

export interface Realtime {
  io: Server;
  close(): Promise<void>;
}

/**
 * Live seat counts over Socket.IO.
 *
 * Anyone may watch a published event's availability — it is the same data
 * the public event page shows. The organiser channel (live check-in counts)
 * requires an access token in the handshake and ownership of the event.
 *
 * Purchases publish `inventory.changed`; broadcasts are coalesced per event
 * so a rush of 500 reservations sends a handful of updates, not 500.
 *
 * Runs on a single instance. Scaling to several would need the Socket.IO
 * Redis adapter so a broadcast on one instance reaches clients on another.
 */
export function attachRealtime(httpServer: HttpServer): Realtime {
  const io = new Server<
    Record<string, never>,
    Record<string, never>,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: { origin: env.CORS_ORIGINS },
    serveClient: false,
    // Browsers behind strict proxies fall back to long-polling automatically.
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    if (typeof token !== 'string' || token.length === 0) {
      socket.data.auth = null;
      next();
      return;
    }
    try {
      const claims = verifyAccessToken(token);
      socket.data.auth = { userId: claims.sub, role: claims.role };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  const roomBudget = (socket: Socket) => socket.rooms.size - 1 < MAX_ROOMS_PER_SOCKET;

  io.on('connection', (socket) => {
    socket.on(SOCKET_EVENTS.subscribeEvent, async (eventId: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
      try {
        if (typeof eventId !== 'string' || !Types.ObjectId.isValid(eventId))
          return reply({ ok: false, error: 'bad event id' });
        if (!roomBudget(socket)) return reply({ ok: false, error: 'too many subscriptions' });
        const event = await EventModel.findById(eventId).select('status').lean();
        if (event?.status !== 'published' && event?.status !== 'cancelled') {
          return reply({ ok: false, error: 'not found' });
        }
        await socket.join(eventRoom(eventId));
        reply({ ok: true, data: await availabilityFor(eventId) });
      } catch (err) {
        logger.error({ err }, 'event:subscribe failed');
        reply({ ok: false, error: 'internal' });
      }
    });

    socket.on(SOCKET_EVENTS.unsubscribeEvent, async (eventId: unknown) => {
      if (typeof eventId === 'string') await socket.leave(eventRoom(eventId));
    });

    socket.on(SOCKET_EVENTS.subscribeOrganiser, async (eventId: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
      try {
        const auth = socket.data.auth;
        if (!auth) return reply({ ok: false, error: 'unauthorized' });
        if (typeof eventId !== 'string' || !Types.ObjectId.isValid(eventId))
          return reply({ ok: false, error: 'bad event id' });
        if (!roomBudget(socket)) return reply({ ok: false, error: 'too many subscriptions' });
        const event = await EventModel.findById(eventId).select('organiserId').lean();
        try {
          assertCanManage(event?.organiserId, auth);
        } catch {
          return reply({ ok: false, error: 'not found' });
        }
        await socket.join(organiserRoom(eventId));
        reply({ ok: true, data: await checkInStats(new Types.ObjectId(eventId)) });
      } catch (err) {
        logger.error({ err }, 'organiser:subscribe failed');
        reply({ ok: false, error: 'internal' });
      }
    });
  });

  const broadcastAvailability = coalesce(COALESCE_MS, async (eventId) => {
    const update = await availabilityFor(eventId);
    io.to([eventRoom(eventId), organiserRoom(eventId)]).emit(SOCKET_EVENTS.availability, update);
  });

  const broadcastCheckIn = coalesce(COALESCE_MS, async (eventId) => {
    const stats: CheckInStats = await checkInStats(new Types.ObjectId(eventId));
    io.to(organiserRoom(eventId)).emit(SOCKET_EVENTS.checkIn, { eventId, ...stats });
  });

  const unsubscribers = [
    subscribe('inventory.changed', ({ eventId }) => broadcastAvailability(eventId)),
    subscribe('ticket.checked-in', ({ eventId }) => broadcastCheckIn(eventId)),
  ];

  return {
    io,
    /**
     * Drops live connections without closing the HTTP server, which the
     * caller owns. Open WebSockets would otherwise keep `server.close()`
     * waiting until the shutdown timer forces the process down.
     */
    close() {
      unsubscribers.forEach((u) => u());
      io.disconnectSockets(true);
      io.engine.close();
      return Promise.resolve();
    },
  };
}
