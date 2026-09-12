# Gatherly

Event ticketing for independent and community organisers — built so a
rush of buyers can never be sold more seats than exist, tickets cannot be
forged or reused at the door, and money is never kept for seats that were
not delivered.




## What it does

| Role          | Can                                                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Attendee**  | Browse and search events, see live seat counts, reserve seats (held 8 minutes), apply promo codes, pay with Razorpay, get QR tickets by page, PDF and email                                                |
| **Organiser** | Create events with ticket types and banner images, submit for review, manage promo codes, view sales analytics, refund orders, cancel (refunds everyone), check tickets in at the door with a phone camera |
| **Admin**     | Approve or send back submitted events, read the audit log of every privileged action                                                                                                                       |

## Stack

| Layer    | Choice                                                                          |
| -------- | ------------------------------------------------------------------------------- |
| Runtime  | Node.js 24 LTS, TypeScript 6.0 (strict), pnpm 11 workspace                      |
| API      | Express 5, Mongoose 9 on MongoDB (replica set, for transactions), Zod 4         |
| Jobs     | BullMQ 6 on Redis — hold expiry, sweeper, reconciliation, ticket email, refunds |
| Realtime | Socket.IO 4.8.3                                                                 |
| Payments | Razorpay (orders, Checkout, webhooks, refunds)                                  |
| Web      | React 19 + React Compiler, Vite 8, Tailwind 4, TanStack Query 5, React Router 8 |
| Other    | Argon2id, Cloudinary signed uploads, Resend email, pdfkit + qrcode              |
| Hosting  | Render (API), Netlify (web), MongoDB Atlas, Upstash Redis                       |

## Repository layout

```
apps/
  api/                 Express API, background workers, Socket.IO
    src/services/      business logic (inventory, orders, payments, check-in, …)
    src/jobs/          BullMQ queues and processors
    scripts/           seed data, oversell load test
    load-test-results/ committed results of the oversell experiment
  web/                 React app
    e2e/               Playwright journeys
packages/
  types/               Zod schemas shared by API and web — the API contract
```

## Running locally

Prerequisites: Node 24, `corepack enable`, and Redis (`brew install redis && brew services start redis`).
No local MongoDB install is needed.

```bash
pnpm install
pnpm --filter @gatherly/types build

# Terminal 1 — a local MongoDB replica set (transactions need one)
pnpm --filter @gatherly/api db:dev

# Terminal 2 — API on :4000
cp apps/api/.env.example apps/api/.env   # then fill the secrets (see file)
pnpm --filter @gatherly/api seed --reset
pnpm --filter @gatherly/api dev

# Terminal 3 — web on :5173
pnpm --filter @gatherly/web dev
```

Open http://localhost:5173. Seeded accounts all use the password
`gatherly-demo-2026`: `admin@gatherly.dev`, `meera@gatherly.dev` and
`rahul@gatherly.dev` (organisers), `ananya@gatherly.dev` (attendee with
tickets). Payments need Razorpay test keys in `.env`; free events work
without them. Emails are logged instead of sent until `RESEND_API_KEY` is set.

## Checks

```bash
pnpm -r typecheck
pnpm lint
pnpm format:check
pnpm --filter @gatherly/api test:run        # 114 integration tests (needs Redis)
pnpm --filter @gatherly/web e2e             # 6 browser journeys (dev servers running)
pnpm --filter @gatherly/api load-test       # oversell experiment → load-test-results/
```

CI runs typecheck, lint, format, tests and both builds on every push.

## How overselling is prevented

`apps/api/load-test-results/results.md` has the measured evidence. With
500 buyers rushing 100 seats, a naive check-then-increment grants **500**;
Gatherly grants exactly **100**, every run. One user firing 20 parallel
requests against a limit of 4 gets exactly **4**.

Three layers, in `apps/api/src/services/inventory.service.ts`:

1. **Guarded atomic update** — MongoDB checks `total − sold − held ≥ qty` and
   increments in one operation. This alone makes overselling impossible.
2. **Transaction** — binds that increment to the hold record and the
   per-user limit check.
3. **Per-user Redis lock** (compare-and-delete release) — stops one user's
   burst of clicks becoming conflicting transactions. If Redis is down,
   reservations continue safely on layers 1 and 2.

Holds expire through a delayed job per hold, a sweeper every minute, and a
reconciler every ten minutes — not a TTL index, which would delete holds
without returning their seats to sale.

## Security summary

Argon2id passwords · rotating refresh tokens stored hashed, with reuse
detection · access tokens in memory only · rate limits per IP, per
IP+email and per user · Zod validation on every input plus NoSQL operator
sanitising · Helmet · strict CORS · role **and** ownership checks ·
HMAC-signed single-use QR tickets · Razorpay webhook signatures verified
over raw bytes with idempotent processing · audit log · pnpm supply-chain
quarantine and install-script allowlist. Card details never touch the
server (PCI DSS SAQ A).

## Deploying

- **API:** Render Blueprint from `render.yaml`.
- **Web:** Netlify using `netlify.toml`; set `API_ORIGIN` and `VITE_SOCKET_URL`
  to the Render URL.
- **Razorpay webhook:** `https://<render-host>/api/webhooks/razorpay` with
  events `payment.captured`, `order.paid`, `payment.failed`,
  `refund.processed`, `refund.failed`.
