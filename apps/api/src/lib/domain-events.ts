import { logger } from './logger.js';

/**
 * In-process publish/subscribe for side effects that must not be tangled
 * into core logic: scheduling a hold's expiry job, broadcasting availability
 * over Socket.IO, queueing ticket emails, dispatching refunds.
 *
 * Publishing happens after the database transaction commits. A subscriber
 * failing is logged and never rolls back or fails the request that caused it
 * — each side effect has its own recovery path (the sweeper for expiry jobs,
 * the next broadcast for availability, job retries for email and refunds).
 */
export interface DomainEvents {
  'hold.created': { holdId: string; expiresAt: Date; eventId: string; tierId: string };
  'inventory.changed': { eventId: string; tierIds: string[] };
  'order.paid': { orderId: string };
  'event.cancelled': { eventId: string };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void> | void;

const handlers = new Map<keyof DomainEvents, Handler<keyof DomainEvents>[]>();

export function subscribe<K extends keyof DomainEvents>(name: K, handler: Handler<K>): () => void {
  const list = handlers.get(name) ?? [];
  list.push(handler as Handler<keyof DomainEvents>);
  handlers.set(name, list);
  return () => {
    const current = handlers.get(name) ?? [];
    handlers.set(
      name,
      current.filter((h) => h !== (handler as Handler<keyof DomainEvents>)),
    );
  };
}

/** Resolves when every subscriber has finished; never rejects. */
export async function publish<K extends keyof DomainEvents>(
  name: K,
  payload: DomainEvents[K],
): Promise<void> {
  const results = await Promise.allSettled((handlers.get(name) ?? []).map(async (h) => h(payload)));
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error(
        { err: result.reason as unknown, event: name },
        'Domain event subscriber failed',
      );
    }
  }
}
