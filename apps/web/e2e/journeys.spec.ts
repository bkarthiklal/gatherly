import type { EventSummary, Paginated } from '@gatherly/types';
import { apiGet, expect, test } from './fixtures';

async function eventBy(q: string): Promise<EventSummary> {
  const res = await apiGet<Paginated<EventSummary>>(`/events?q=${encodeURIComponent(q)}`);
  const event = res.items[0];
  if (!event) throw new Error(`No published event matching "${q}"`);
  return event;
}

let freeTicketSerial = '';

test('signed-out visitors are sent to sign in, then back', async ({ page }) => {
  await page.goto('/tickets');
  await expect(page).toHaveURL(/\/login\?next=%2Ftickets$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('buyer reserves a free ticket, checks out and sees its QR code', async ({
  page,
  signInAs,
}) => {
  const swap = await eventBy('book swap');
  await signInAs('dev@gatherly.dev');

  await page.goto(`/events/${swap.slug}`);
  await expect(page.getByRole('heading', { name: swap.title, level: 1 })).toBeVisible();
  await expect(page.getByText('Live availability')).toBeVisible();

  await page.getByRole('button', { name: 'Add one Free entry' }).click();
  await page.getByRole('button', { name: 'Reserve and check out' }).click();

  await expect(page).toHaveURL(/\/checkout\?holds=/);
  await expect(page.getByRole('timer')).toContainText('Seats held for');
  await page.getByRole('button', { name: 'Confirm free tickets' }).click();

  await expect(page).toHaveURL(/\/orders\/[0-9a-f]{24}$/);
  await expect(page.getByRole('heading', { name: `You're going to ${swap.title}!` })).toBeVisible();

  await page.getByRole('link', { name: 'Show QR' }).first().click();
  const qr = page.getByRole('img', { name: /QR code for ticket GTH-/ });
  await expect(qr).toBeVisible();
  freeTicketSerial = ((await qr.getAttribute('alt')) ?? '').replace('QR code for ticket ', '');
  expect(freeTicketSerial).toMatch(/^GTH-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(page.getByText('Valid · show this at the door')).toBeVisible();

  await page.goto('/tickets');
  await expect(page.getByText(freeTicketSerial)).toBeVisible();
});

test('organiser admits that ticket once at the door, then sees it already used', async ({
  page,
  signInAs,
}) => {
  test.skip(!freeTicketSerial, 'depends on the purchase journey');
  const swap = await eventBy('book swap');
  await signInAs('meera@gatherly.dev');

  await page.goto(`/organiser/events/${swap.id}/check-in`);
  await expect(page.getByRole('heading', { name: 'Scan tickets' })).toBeVisible();

  const serial = page.getByLabel('Ticket serial');
  await serial.fill(freeTicketSerial.toLowerCase());
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Admit' })).toContainText('Dev Malhotra');

  await serial.fill(freeTicketSerial);
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Already used' })).toBeVisible();
});

test('organiser dashboard, analytics, orders and promo codes render with real data', async ({
  page,
  signInAs,
}) => {
  await signInAs('meera@gatherly.dev');
  await page.goto('/organiser');
  await expect(page.getByRole('heading', { name: 'Organiser dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'Indiranagar Indie Nights' }).click();
  await expect(page.getByRole('heading', { name: 'Indiranagar Indie Nights' })).toBeVisible();
  await expect(page.getByText('Tickets sold')).toBeVisible();
  await expect(page.getByText('Sales by day')).toBeVisible();
  await expect(page.locator('.recharts-surface')).toBeVisible();

  await page.getByRole('tab', { name: 'Orders' }).click();
  await expect(page.getByText('Arjun Rao')).toBeVisible();

  await page.getByRole('tab', { name: 'Promo codes' }).click();
  await expect(page.getByRole('cell', { name: 'INDIE20', exact: true })).toBeVisible();
});

test('organiser creates an event, submits it, and an admin approves it', async ({
  page,
  signInAs,
}) => {
  const title = `E2E Rooftop Film Night ${Date.now().toString(36)}`;
  await signInAs('rahul@gatherly.dev');

  await page.goto('/organiser/events/new');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page
    .getByLabel('Description')
    .fill('An outdoor screening of a classic film with blankets and popcorn provided.');
  await page.getByLabel('Category').selectOption('arts');
  await page.getByLabel('Starts (IST)').fill('2027-01-15T19:00');
  await page.getByLabel('Ends (IST)').fill('2027-01-15T22:00');
  await page.getByLabel('Venue name').fill('Sky Deck');
  await page.getByLabel('Address', { exact: true }).fill('MG Road');
  await page.getByLabel('City', { exact: true }).fill('Bengaluru');
  await page.getByRole('button', { name: 'Create draft' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('In review', { exact: true })).toBeVisible();

  await page.context().clearCookies();
  await signInAs('admin@gatherly.dev');
  await page.goto('/admin');
  // Each queued event is a card; pick the one holding this title.
  const card = page
    .locator('div.rounded-xl')
    .filter({ has: page.getByRole('heading', { name: title }) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('heading', { name: title })).toHaveCount(0);

  await page.getByRole('button', { name: 'Audit log' }).click();
  await expect(page.getByText('event.approve').first()).toBeVisible();
});

test('paid checkout explains clearly when payments are not configured, and releases seats on cancel', async ({
  page,
  signInAs,
}) => {
  const conf = await eventBy('reactconf');
  await signInAs('zoya@gatherly.dev');

  await page.goto(`/events/${conf.slug}`);
  await page.getByRole('button', { name: 'Add one Professional' }).click();
  await page.getByRole('button', { name: 'Reserve and check out' }).click();
  await expect(page).toHaveURL(/\/checkout/);

  await page.getByLabel('Promo code').fill('nope');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('This promo code is not valid for this event')).toBeVisible();

  await page.getByRole('button', { name: /^Pay ₹/ }).click();
  await expect(page.getByRole('alert')).toContainText(/not configured|Razorpay/);

  await page.getByRole('button', { name: 'Cancel and release seats' }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${conf.slug}`));
});
