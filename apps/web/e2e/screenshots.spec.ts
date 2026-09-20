import { mkdirSync } from 'node:fs';
import type { EventSummary, Paginated } from '@gatherly/types';
import { apiGet, expect, test } from './fixtures';

/**
 * Captures documentation screenshots. Skipped in normal runs:
 *   CAPTURE=1 pnpm --filter @gatherly/web e2e screenshots
 * Run against freshly seeded data. Output dir overridable via SHOT_DIR.
 */
const OUT = new URL(process.env.SHOT_DIR ?? '../../../.screenshots/', import.meta.url).pathname;

test.describe('documentation screenshots', () => {
  test.skip(!process.env.CAPTURE, 'set CAPTURE=1 to capture screenshots');
  test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

  test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });

  const shot = (name: string) => ({ path: `${OUT}${name}.png`, fullPage: false });

  async function eventBy(q: string): Promise<EventSummary> {
    const res = await apiGet<Paginated<EventSummary>>(`/events?q=${encodeURIComponent(q)}`);
    return res.items[0]!;
  }

  test('public pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Coming up' })).toBeVisible();
    await page.screenshot(shot('01-home'));

    await page.goto('/events');
    await expect(page.getByText(/\d+ events?/)).toBeVisible();
    await page.screenshot(shot('02-browse'));

    const pottery = await eventBy('pottery');
    await page.goto(`/events/${pottery.slug}`);
    await expect(page.getByText('Live availability')).toBeVisible();
    await page.screenshot(shot('03-event-live-availability'));
  });

  test('buyer checkout and ticket', async ({ page, signInAs }) => {
    const indie = await eventBy('indie');
    await signInAs('nisha@gatherly.dev');
    await page.goto(`/events/${indie.slug}`);
    await page.getByRole('button', { name: 'Add one General' }).click();
    await page.getByRole('button', { name: 'Add one General' }).click();
    await page.screenshot(shot('04-ticket-selection'));
    await page.getByRole('button', { name: 'Reserve and check out' }).click();
    await page.getByLabel('Promo code').fill('INDIE20');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Discount (INDIE20)')).toBeVisible();
    await page.screenshot(shot('05-checkout-with-promo'));
    await page.getByRole('button', { name: 'Cancel and release seats' }).click();

    await signInAs('ananya@gatherly.dev');
    await page.goto('/tickets');
    await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
    await page.screenshot(shot('06-my-tickets'));
    await page.getByRole('link', { name: /GTH-/ }).first().click();
    await expect(page.getByRole('img', { name: /QR code for ticket/ })).toBeVisible();
    await page.screenshot(shot('07-ticket-qr'));
  });

  test('organiser screens', async ({ page, signInAs }) => {
    await signInAs('meera@gatherly.dev');
    await page.goto('/organiser');
    await expect(page.getByRole('heading', { name: 'Organiser dashboard' })).toBeVisible();
    await page.screenshot(shot('08-organiser-dashboard'));

    await page.getByRole('link', { name: 'Indiranagar Indie Nights' }).click();
    await expect(page.locator('.recharts-surface')).toBeVisible();
    await page.screenshot({ path: `${OUT}09-analytics.png`, fullPage: true });

    await page.getByRole('tab', { name: 'Orders' }).click();
    await expect(page.getByText('Arjun Rao')).toBeVisible();
    await page.screenshot(shot('10-orders'));

    await page.getByRole('tab', { name: 'Promo codes' }).click();
    await expect(page.getByRole('cell', { name: 'INDIE20', exact: true })).toBeVisible();
    await page.screenshot(shot('11-promo-codes'));

    await page.goto('/organiser/events/new');
    await expect(page.getByRole('heading', { name: 'Create an event' })).toBeVisible();
    await page.screenshot(shot('12-create-event'));
  });

  test('check-in results', async ({ page, signInAs }) => {
    // A fresh free ticket, so the first scan is guaranteed to admit.
    const swap = await eventBy('book swap');
    await signInAs('vikram@gatherly.dev');
    await page.goto(`/events/${swap.slug}`);
    await page.getByRole('button', { name: 'Add one Free entry' }).click();
    await page.getByRole('button', { name: 'Reserve and check out' }).click();
    await page.getByRole('button', { name: 'Confirm free tickets' }).click();
    await page.getByRole('link', { name: 'Show QR' }).first().click();
    const qr = page.getByRole('img', { name: /QR code for ticket GTH-/ });
    await expect(qr).toBeVisible();
    const serial = ((await qr.getAttribute('alt')) ?? '').replace('QR code for ticket ', '');

    await page.context().clearCookies();
    await signInAs('meera@gatherly.dev');
    await page.goto(`/organiser/events/${swap.id}/check-in`);
    await page.getByRole('button', { name: 'Stop camera' }).click();

    await page.getByLabel('Ticket serial').fill(serial);
    await page.getByRole('button', { name: 'Check in' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Admit' })).toBeVisible();
    await page.screenshot(shot('13-check-in-admitted'));

    await page.getByRole('button', { name: 'Ready for next' }).click();
    await page.getByLabel('Ticket serial').fill(serial);
    await page.getByRole('button', { name: 'Check in' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Already used' })).toBeVisible();
    await page.screenshot(shot('14-check-in-already-used'));
  });

  test('admin screens', async ({ page, signInAs }) => {
    await signInAs('admin@gatherly.dev');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Monsoon Jazz on the Terrace' })).toBeVisible();
    await page.screenshot(shot('15-admin-review-queue'));
    await page.getByRole('button', { name: 'Audit log' }).click();
    await expect(page.getByText('event.approve').first()).toBeVisible();
    await page.screenshot(shot('16-audit-log'));
  });
});
