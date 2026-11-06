# Mandi

**Your AI shops. Their AI sells. PayPal makes it safe.**

Mandi is an agent-to-agent marketplace built for the PayPal AI Hackathon. Every small seller gets an AI sales agent, and every shopper can send an AI buying agent. The two agents haggle within limits that code enforces. PayPal holds the buyer's money until the seller ships.

*Mandi* is the Hindi word for a traditional market where buyers and sellers haggle face to face.

- **Live demo:** _add the Render URL_
- **Video:** _add the YouTube link_
- **Try it:** open the live demo and click **Try the demo**. Approve the deal with the sandbox buyer login shown next to the PayPal button.

![Mandi architecture](docs/architecture.svg)

## The problem

AI shopping agents buy from merchants that have structured catalogs. Artisans, home businesses and micro-exporters have no catalog, no website and no time to answer buyers. As shopping moves to agents, they become invisible.

## What Mandi does

1. **Seller onboarding in a minute.** Meera, a handloom weaver in Varanasi, uploads photos and records a voice note, in Hindi if she likes.
   - Her agent writes an English listing.
   - Channel3 comparable products suggest a price range.
   - She sets a private floor price, and the listing becomes a PayPal catalog product through the Agent Toolkit.
2. **One sentence from the buyer.** Sarah in London types "Handwoven silk scarf for my mum, under £90, by Dec 20". Her agent turns it into a mandate: budget, deadline and ship-to country. She confirms it once.
3. **Parallel negotiation, visible.** Sarah's agent negotiates with up to three sellers at once. The negotiation room streams every turn with a price chart per seller. It shows both the price an agent proposed and the price the engine allowed.
   After a deal is agreed, the seller agent may offer one more of the seller's items as a bundle. The engine checks that the item clears its own floor and that the order total stays within the buyer's budget; the buyer agent accepts only if it fits the request.
4. **One tap.** The buyer agent recommends one deal with its reasons. Sarah approves it, and PayPal authorizes the amount and holds it.
5. **Ship, then get paid.** The seller adds tracking, Mandi captures the payment, and the tracking is attached to the PayPal order.
6. **Problems handled.** Sarah reports a problem, optionally with a photo. The seller's agent proposes a refund; anything within the seller's cap is refunded through PayPal at once, and anything above it waits for the seller's approval. For a formal PayPal dispute, the order page downloads an evidence pack: listing, chat log, tracking and photo.

Meera follows all of this on a phone-sized view in Hindi with rupee amounts (`/seller/[id]`): "बिक गया! … कृपया भेजें", then "भुगतान मिल गया".

## Accounts

Sellers and buyers sign up at `/signup`. A seller account also creates the seller profile: city, the story their agent tells, the PayPal account they're paid into, language, ship-by days, delivery time and refund cap. Logins use email and password (scrypt-hashed) with a signed, HTTP-only session cookie. Every API route checks the session and ownership: a buyer only sees their own requests and orders, and a seller only their own listings, orders and floors.

For judges, `/login` has one-click demo accounts (Sarah the buyer; Meera, Arjun and Fatima the sellers), and **Try the demo** signs in as Sarah automatically. The demo logins can be turned off with `DEMO_LOGINS=0`.

## Safety design

| Rule | How it's enforced |
| --- | --- |
| The LLM proposes, code decides | Every agent turn passes `applyGuardrails` (`lib/engine/negotiation.ts`) before it is saved, shown or sent to the other agent |
| Seller floor, buyer ceiling | An offer past a limit is blocked and never delivered; the room shows the block. Blocking, not clamping, keeps the limit itself off the table. The approval endpoint re-checks both limits before any PayPal call |
| Leak filter | Before any message reaches the other side, the engine removes the sender's own private limit from the text and shows "[withheld]" |
| No backtracking, 6 rounds | A seller can't raise its own offer and a buyer can't lower its own; a negotiation expires after 6 rounds |
| Information isolation | The floor never enters buyer prompts and the ceiling never enters seller prompts (`tests/agents.test.ts`) |
| Prompt injection | Counterparty messages reach the other agent as `<counterparty_message>` data. Injection attempts are labelled. The attack test (landing page) also simulates a seller agent that falls for it: its £1 offer is blocked and its leaked floor is withheld |
| AI never touches money | Authorize, capture, refund and void live in `lib/paypal/rest.ts` and `lib/orders/service.ts`. No agent can call them. The Agent Toolkit gets only products and shipment tracking |
| Human approval | No PayPal order exists without the buyer's tap; refunds above the seller's per-listing cap need the seller's tap |
| Bundles | A bundle add-on must clear its own floor, and main price plus add-on must stay within the buyer's ceiling. The PayPal order lists both items |
| Holds expire | A hold the seller hasn't shipped within their ship-by window is voided automatically, so the buyer is never charged |
| Idempotent money calls | Every POST carries a `PayPal-Request-Id`. Each action claims the order row first, so a double click can't capture or refund twice |
| Integer money | Prices are stored as minor units (pence) |

## PayPal APIs used

| Capability | Endpoint / tool | Triggered by |
| --- | --- | --- |
| OAuth token | `POST /v1/oauth2/token` | Server, cached until expiry |
| Catalog product | Agent Toolkit `create_product` | Seller publishes a listing |
| Create order (AUTHORIZE) | `POST /v2/checkout/orders` | Buyer taps Approve |
| Authorize | `POST /v2/checkout/orders/{id}/authorize` | PayPal approval callback |
| Capture | `POST /v2/payments/authorizations/{id}/capture` | Seller posts tracking |
| Tracking | `POST /v2/checkout/orders/{id}/track` | Right after capture |
| Refund | `POST /v2/payments/captures/{id}/refund` | Agent proposal within cap, or the seller's tap |
| Void | `POST /v2/payments/authorizations/{id}/void` | Seller can't ship |
| Show order | `GET /v2/checkout/orders/{id}` | Status sync |
| Webhooks | `POST /v1/notifications/verify-webhook-signature` | PayPal events (order status only moves forward) |
| Buyer UI | PayPal JS SDK buttons, `intent=authorize` | Negotiation room |

Every call is written to `paypal_events`, which feeds the docked "PayPal API calls" panel.

## Built with

| Layer | Choice |
| --- | --- |
| App | Next.js 15 (App Router), TypeScript, Tailwind |
| Agents | Claude (`claude-sonnet-5-5`, set with `MANDI_MODEL`) through the Anthropic TypeScript SDK, structured output with Zod; vision for listings and refund checks |
| Speech-to-text | OpenAI `gpt-transcribe` |
| Product data | Channel3 (`@channel3/sdk`) |
| Payments | PayPal Orders v2 + Payments v2 (REST), PayPal Agent Toolkit, PayPal JS SDK |
| Database | Postgres + Drizzle ORM |
| Live updates | Server-Sent Events |
| Dashboard | AG Grid Community + AG Charts |
| Hosting | Render (`render.yaml`) |
| API docs | Postman collection in `docs/` |
| Built using | Claude Code |

**If the model is unavailable** (no `ANTHROPIC_API_KEY`, a refusal, or invalid output twice), agents fall back to rule-based turns that still pass through the engine. The demo never stalls, and the room labels those turns "rule-based".

## Run locally

1. Install dependencies.

   ```bash
   npm install
   ```

2. Copy the env template and fill in your keys.

   ```bash
   cp .env.example .env.local
   ```

   PayPal needs a sandbox REST app plus sandbox accounts: three businesses (sellers) and one personal account (buyer). Drizzle and the seed script read `.env`, so copy `.env.local` to `.env` as well, or export `DATABASE_URL`.

3. Create the tables and seed the demo data (3 sellers, 8 listings, 2 past orders).

   ```bash
   npm run db:push
   npm run db:seed
   ```

4. Start the app.

   ```bash
   npm run dev
   ```

**Pages:** `/` (Try the demo), `/login`, `/signup`, `/shop`, `/orders`, `/deal/[id]`, `/order/[id]`, `/sell`, `/dashboard`, `/seller` (the seller's phone view), and `/paypal-test` (a bare sandbox check).

## Tests

```bash
npm test
```

This runs the unit tests: guardrails, order states, prompt isolation, mandate parsing and scoring.

The money-flow and full-negotiation tests need a Postgres with the schema pushed. They empty that database's tables on each run:

```bash
createdb mandi_test
DATABASE_URL=postgres://localhost:5432/mandi_test npx drizzle-kit push
TEST_DATABASE_URL=postgres://localhost:5432/mandi_test npm test
```

The manual sandbox test matrix is in [docs/LAUNCH.md](docs/LAUNCH.md).

## Deploy

`render.yaml` defines the web service and a Postgres database, with a health check at `/api/health`.

1. Set the `sync: false` secrets in the Render dashboard, including the `NEXT_PUBLIC_*` values, which are read at build time.
2. Run `npm run db:seed` once from the Render shell.
3. Register a PayPal webhook pointing at `/api/paypal/webhook`.

## Layout

```
app/              pages and /api routes
components/       PayPal call log, offers chart, demo button, nav
lib/engine/       negotiation guardrails (pure functions)
lib/agents/       prompts, seller/buyer agents, mandate parser, listing writer, refund agent
lib/negotiation/  runner (parallel negotiations), SSE bus + snapshot, scoring
lib/orders/       order state machine, payment service, problem reports
lib/paypal/       REST money calls, Agent Toolkit, call log
lib/channel3/     comparable prices
lib/dashboard/    seller dashboard data
lib/db/           Drizzle schema and seed
tests/            unit and Postgres-backed tests
docs/             architecture, Postman collection, Devpost draft, launch checklist
```

## Out of scope

- Real money, live merchants, and PayPal Agent Ready / Store Sync. These need a PayPal access request.
- Real carrier tracking; delivery is simulated.
- Platform fees, marketplace payouts and seller KYC.
- Mobile apps; the web app is responsive.
- Password reset, email verification and rate limiting on logins.

## What's next

- Connect Mandi sellers to PayPal's agentic commerce services, so they appear inside AI shopping assistants.
- Reauthorize holds for sellers who need more than 3 days to ship.
- Onboarding in more Indian languages.
- Marketplace payouts.

## License

MIT
