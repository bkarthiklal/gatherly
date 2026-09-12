import { createBrowserRouter } from 'react-router';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { BrowsePage } from './pages/BrowsePage';
import { EventPage } from './pages/EventPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RouteError } from './pages/RouteError';

/**
 * Public pages ship in the main bundle. Everything behind sign-in is loaded
 * on first visit, so a buyer landing on an event page never downloads the
 * organiser dashboard, the charting library or the QR scanner.
 */
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/events', element: <BrowsePage /> },
      { path: '/events/:slug', element: <EventPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      {
        path: '/checkout',
        lazy: async () => ({ Component: (await import('./pages/CheckoutPage')).CheckoutPage }),
      },
      {
        path: '/orders/:orderId',
        lazy: async () => ({ Component: (await import('./pages/OrderPage')).OrderPage }),
      },
      {
        path: '/tickets',
        lazy: async () => ({ Component: (await import('./pages/TicketsPage')).TicketsPage }),
      },
      {
        path: '/tickets/:ticketId',
        lazy: async () => ({ Component: (await import('./pages/TicketPage')).TicketPage }),
      },
      {
        path: '/organiser',
        lazy: async () => ({
          Component: (await import('./pages/organiser/DashboardPage')).DashboardPage,
        }),
      },
      {
        path: '/organiser/events/new',
        lazy: async () => ({
          Component: (await import('./pages/organiser/EventFormPage')).NewEventPage,
        }),
      },
      {
        path: '/organiser/events/:eventId',
        lazy: async () => ({
          Component: (await import('./pages/organiser/ManageEventPage')).ManageEventPage,
        }),
      },
      {
        path: '/organiser/events/:eventId/edit',
        lazy: async () => ({
          Component: (await import('./pages/organiser/EventFormPage')).EditEventPage,
        }),
      },
      {
        path: '/organiser/events/:eventId/check-in',
        lazy: async () => ({
          Component: (await import('./pages/organiser/CheckInPage')).CheckInPage,
        }),
      },
      {
        path: '/admin',
        lazy: async () => ({ Component: (await import('./pages/admin/AdminPage')).AdminPage }),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
