# Mandi

**Your AI shops. Their AI sells. PayPal makes it safe.**

Mandi is an agent-to-agent marketplace for the PayPal AI Hackathon. A small seller's AI agent negotiates with a shopper's AI agent. PayPal holds the buyer's money (authorize) and takes it only once the seller adds tracking (capture).

## Safety design

- **The LLM proposes and code decides.** Every agent turn passes through `lib/engine/negotiation.ts`. That code enforces the seller floor, the buyer ceiling, no backtracking, a 6-round limit, the agreement rule and refund caps.
- **Agents never touch money.** Authorize, capture, refund and void live in `lib/paypal/rest.ts`. No agent imports it.
- **Every money POST carries a `PayPal-Request-Id`**, so a retry or a double click can't double-charge.
- **Prices are stored as integer minor units** (pence/paise).

## Status

Days 1–2 of the build plan:

| Area | State |
| --- | --- |
| Next.js 15 + Tailwind scaffold | done |
| Drizzle schema (7 tables) + seed | done |
| Negotiation engine + guardrail tests | done (`npm test`) |
| PayPal REST: OAuth, create (AUTHORIZE), authorize | done |
| Order service: ship (capture + tracking), partial/full refund, void | done, tested against Postgres with PayPal mocked |
| Webhook listener with signature verification | done; needs `PAYPAL_WEBHOOK_ID` and a public URL to test |
| `/paypal-test` page and `/order/[id]` tracker with the PayPal call log | done |
| Live sandbox run (real PayPal popup) | waiting on sandbox keys |
| Agents, onboarding, negotiation room, dashboard | not started |

## Run locally

1. Install dependencies.

   ```bash
   npm install
   ```

2. Copy the env template and fill in your keys.

   ```bash
   cp .env.example .env.local
   ```

   Fill in `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (the same client id) and `DATABASE_URL`. Drizzle and the seed script read `.env`, so also copy `.env.local` to `.env`, or export `DATABASE_URL` in your shell.

3. Create the tables and seed the demo data.

   ```bash
   npm run db:push
   npm run db:seed
   ```

4. Start the app.

   ```bash
   npm run dev
   ```

Then open `/paypal-test`, approve with the sandbox buyer (Sarah) login, and you should see "£72 held". The authorization ID is stored in `orders.authorization_id`.

## Tests

```bash
npm test
```

This runs the guardrail and order-state tests. The money-flow tests in `tests/paypal-flow.test.ts` also need a Postgres with the schema pushed, and they truncate `orders` and `paypal_events`:

```bash
createdb mandi_test
DATABASE_URL=postgres://localhost:5432/mandi_test npx drizzle-kit push
TEST_DATABASE_URL=postgres://localhost:5432/mandi_test npm test
```

## Layout

```
app/              pages and /api routes
lib/engine/       negotiation state machine and guardrails (pure functions)
lib/paypal/       rest.ts (money calls), log.ts (paypal_events)
lib/orders/       state.ts (status machine), service.ts (ship, refund, void)
components/       PayPalCallLog
lib/db/           schema.ts (Drizzle), seed.ts
tests/            guardrails, order-state, paypal-flow
```

## Deploy

`render.yaml` defines the web service and a Postgres database, with a health check at `/api/health`. Set the `sync: false` secrets in the Render dashboard.

## License

MIT
