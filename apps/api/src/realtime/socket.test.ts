import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SOCKET_EVENTS, type AvailabilityUpdate, type CheckInStats } from '@gatherly/types';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeRedis } from '../lib/redis.js';
import { EventModel } from '../models/event.model.js';
import { reserveSeats } from '../services/inventory.service.js';
import { signAccessToken } from '../services/token.service.js';
import {
  app,
  buyTickets,
  createAttendees,
  createUser,
  seedPublishedTier,
} from '../test/helpers.js';
import { attachRealtime, type Realtime } from './socket.js';

let http: HttpServer;
let realtime: Realtime;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  http = createServer(app);
  realtime = attachRealtime(http);
  await new Promise<void>((resolve) => http.listen(0, resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterEach(() => {
  sockets.splice(0).forEach((s) => s.disconnect());
});

afterAll(async () => {
  await realtime.close();
  await new Promise((resolve) => http.close(resolve));
  await closeRedis();
});

async function client(token?: string): Promise<Socket> {
  const socket = connect(url, {
    transports: ['websocket'],
    forceNew: true,
    ...(token ? { auth: { token } } : {}),
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function collect<T>(socket: Socket, event: string): T[] {
  const received: T[] = [];
  socket.on(event, (payload: T) => received.push(payload));
  return received;
}

const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

describe('live availability', () => {
  it('sends current availability on subscribe and pushes changes after purchases', async () => {
    const { eventId, tierId } = await seedPublishedTier({ quantityTotal: 20 });
    const socket = await client();

    const subscribed = await emitAck<AvailabilityUpdate>(
      socket,
      SOCKET_EVENTS.subscribeEvent,
      eventId,
    );
    expect(subscribed).toEqual({
      ok: true,
      data: { eventId, tiers: [{ id: tierId, quantityAvailable: 20, onSale: true }] },
    });

    const updates = collect<AvailabilityUpdate>(socket, SOCKET_EVENTS.availability);
    const [buyer] = await createAttendees(1);
    await reserveSeats(buyer!, { tierId, quantity: 3 });
    await settle();

    expect(updates.at(-1)).toEqual({
      eventId,
      tiers: [{ id: tierId, quantityAvailable: 17, onSale: true }],
    });
  });

  it('coalesces a burst of purchases into a few broadcasts', async () => {
    const { eventId, tierId } = await seedPublishedTier({ quantityTotal: 100 });
    const socket = await client();
    await emitAck(socket, SOCKET_EVENTS.subscribeEvent, eventId);
    const updates = collect<AvailabilityUpdate>(socket, SOCKET_EVENTS.availability);

    const buyers = await createAttendees(40);
    await Promise.all(buyers.map((b) => reserveSeats(b, { tierId, quantity: 1 })));
    await settle(600);

    expect(updates.length).toBeGreaterThan(0);
    expect(updates.length).toBeLessThan(10);
    expect(updates.at(-1)?.tiers[0]?.quantityAvailable).toBe(60);
  });

  it('does not reveal unpublished events', async () => {
    const { eventId } = await seedPublishedTier();
    await EventModel.updateOne({ _id: eventId }, { status: 'draft' });
    const socket = await client();
    expect(await emitAck(socket, SOCKET_EVENTS.subscribeEvent, eventId)).toEqual({
      ok: false,
      error: 'not found',
    });
    expect(await emitAck(socket, SOCKET_EVENTS.subscribeEvent, { $ne: null })).toEqual({
      ok: false,
      error: 'bad event id',
    });
  });
});

describe('organiser channel', () => {
  it('requires a valid token and ownership, then streams check-in counts', async () => {
    const { eventId, tierId, organiserId } = await seedPublishedTier({ quantityTotal: 10 });
    const ownerToken = signAccessToken({ id: organiserId, role: 'organiser', tokenVersion: 0 });

    const anonymous = await client();
    expect(await emitAck(anonymous, SOCKET_EVENTS.subscribeOrganiser, eventId)).toEqual({
      ok: false,
      error: 'unauthorized',
    });

    const intruder = await createUser('organiser');
    const intruderSocket = await client(intruder.token);
    expect(await emitAck(intruderSocket, SOCKET_EVENTS.subscribeOrganiser, eventId)).toEqual({
      ok: false,
      error: 'not found',
    });

    await expect(client('not-a-real-token')).rejects.toThrow('unauthorized');

    const owner = await client(ownerToken);
    const buyer = await createUser('attendee');
    await buyTickets(buyer.id, tierId, 2);
    expect(await emitAck<CheckInStats>(owner, SOCKET_EVENTS.subscribeOrganiser, eventId)).toEqual({
      ok: true,
      data: { checkedIn: 0, total: 2 },
    });

    const counts = collect<CheckInStats & { eventId: string }>(owner, SOCKET_EVENTS.checkIn);
    const { TicketModel } = await import('../models/ticket.model.js');
    const ticket = await TicketModel.findOne({ eventId }).lean();
    const { checkIn } = await import('../services/checkin.service.js');
    await checkIn({ userId: organiserId, role: 'organiser' }, eventId, { serial: ticket!.serial });
    await settle();

    expect(counts.at(-1)).toEqual({ eventId, checkedIn: 1, total: 2 });
  });
});
