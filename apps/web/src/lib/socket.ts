import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api';

let socket: Socket | null = null;

/**
 * One shared connection. In development Vite proxies /socket.io; in
 * production VITE_SOCKET_URL points at the API host directly, because
 * Netlify's rewrite proxy does not carry WebSockets.
 */
export function getSocket(): Socket {
  if (!socket) {
    const url = (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? window.location.origin;
    socket = io(url, {
      transports: ['websocket', 'polling'],
      auth: (cb) => {
        const token = getAccessToken();
        cb(token ? { token } : {});
      },
    });
  }
  return socket;
}

export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: string };

export function emitWithAck<T>(event: string, payload: unknown): Promise<SocketAck<T>> {
  return new Promise((resolve) => {
    getSocket()
      .timeout(8_000)
      .emit(event, payload, (err: Error | null, response: SocketAck<T>) => {
        resolve(err ? { ok: false, error: 'timeout' } : response);
      });
  });
}
