import { SOCKET_EVENTS, type AvailabilityUpdate, type EventDetail } from '@gatherly/types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { keys } from './queries';
import { emitWithAck, getSocket } from './socket';

/**
 * Keeps an event page's seat counts live. Pushed updates are merged straight
 * into the cached event, so every component reading it re-renders with the
 * new numbers without refetching.
 */
export function useLiveAvailability(event: EventDetail | undefined): boolean {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const eventId = event?.id;
  const slug = event?.slug;
  const live = event?.status === 'published';

  useEffect(() => {
    if (!eventId || !slug || !live) return;
    const socket = getSocket();

    const apply = (update: AvailabilityUpdate) => {
      if (update.eventId !== eventId) return;
      queryClient.setQueryData<EventDetail>(keys.event(slug), (current) =>
        current
          ? {
              ...current,
              tiers: current.tiers.map((t) => {
                const next = update.tiers.find((u) => u.id === t.id);
                return next
                  ? { ...t, quantityAvailable: next.quantityAvailable, onSale: next.onSale }
                  : t;
              }),
            }
          : current,
      );
    };

    const subscribe = () => {
      void emitWithAck<AvailabilityUpdate>(SOCKET_EVENTS.subscribeEvent, eventId).then((res) => {
        setConnected(res.ok);
        if (res.ok) apply(res.data);
      });
    };

    socket.on(SOCKET_EVENTS.availability, apply);
    socket.on('connect', subscribe);
    socket.on('disconnect', () => setConnected(false));
    if (socket.connected) subscribe();

    return () => {
      socket.off(SOCKET_EVENTS.availability, apply);
      socket.off('connect', subscribe);
      socket.emit(SOCKET_EVENTS.unsubscribeEvent, eventId);
    };
  }, [eventId, slug, live, queryClient]);

  return connected;
}
