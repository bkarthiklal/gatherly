import type {
  EventDetail,
  EventSummary,
  Hold,
  ListEventsQuery,
  Order,
  OrganiserEvent,
  Paginated,
  Ticket,
  TicketWithQr,
} from '@gatherly/types';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

export const keys = {
  events: (q: Partial<ListEventsQuery>) => ['events', q] as const,
  event: (slug: string) => ['event', slug] as const,
  holds: ['holds'] as const,
  orders: ['orders'] as const,
  order: (id: string) => ['order', id] as const,
  tickets: ['tickets'] as const,
  ticket: (id: string) => ['ticket', id] as const,
  organiserEvents: ['organiser', 'events'] as const,
  organiserEvent: (id: string) => ['organiser', 'event', id] as const,
};

export const eventsQuery = (q: Partial<ListEventsQuery>) =>
  queryOptions({
    queryKey: keys.events(q),
    queryFn: ({ signal }) => api<Paginated<EventSummary>>('/events', { query: q, signal }),
    placeholderData: (prev) => prev,
  });

export const eventQuery = (slug: string) =>
  queryOptions({
    queryKey: keys.event(slug),
    queryFn: ({ signal }) => api<EventDetail>(`/events/${slug}`, { signal }),
  });

export const holdsQuery = queryOptions({
  queryKey: keys.holds,
  queryFn: ({ signal }) => api<{ items: Hold[] }>('/holds', { signal }).then((r) => r.items),
});

export const ordersQuery = queryOptions({
  queryKey: keys.orders,
  queryFn: ({ signal }) => api<{ items: Order[] }>('/orders', { signal }).then((r) => r.items),
});

export const orderQuery = (id: string) =>
  queryOptions({
    queryKey: keys.order(id),
    queryFn: ({ signal }) => api<Order>(`/orders/${id}`, { signal }),
  });

export const ticketsQuery = queryOptions({
  queryKey: keys.tickets,
  queryFn: ({ signal }) => api<{ items: Ticket[] }>('/tickets', { signal }).then((r) => r.items),
});

export const ticketQuery = (id: string) =>
  queryOptions({
    queryKey: keys.ticket(id),
    queryFn: ({ signal }) => api<TicketWithQr>(`/tickets/${id}`, { signal }),
  });

export const organiserEventsQuery = queryOptions({
  queryKey: keys.organiserEvents,
  queryFn: ({ signal }) =>
    api<{ items: OrganiserEvent[] }>('/organiser/events', { signal }).then((r) => r.items),
});

export const organiserEventQuery = (id: string) =>
  queryOptions({
    queryKey: keys.organiserEvent(id),
    queryFn: ({ signal }) => api<OrganiserEvent>(`/organiser/events/${id}`, { signal }),
  });
