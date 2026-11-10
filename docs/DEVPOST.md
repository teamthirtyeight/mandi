# Devpost submission draft

Fill in the bracketed items, check every claim against the live demo, then paste each section into Devpost.

**Project name:** Mandix
**Tagline (≤ 60 characters):** Send an agent to the bazaar.
**Elevator pitch (≤ 200 characters):** Mandix connects India's artisans to the world: their AI agent sells in their language, haggles with buyers' agents, never drops below their price, and PayPal pays them when it ships.
**Links:** https://mandi-4pjw.onrender.com · https://www.youtube.com/watch?v=IPY8oHCtNMA · https://github.com/teamthirtyeight/mandi
**Sponsor prizes to tick:** AG Grid, Channel3, Render. APIMatic: Mandix's Orders and Payments calls go through PayPal's Server SDK, which APIMatic generates. Tick it only if the prize's criteria accept that; if they require APIMatic's context plugin, leave it.

## Inspiration

India's weavers, potters and block-printers make things the whole world would pay for. Between them and those buyers stand a language, a currency, a website they don't have, and middlemen who keep most of the margin.

Now a new wall is going up. Shoppers are starting to send AI agents to buy for them, and those agents only see stores with tidy, structured catalogs. Meera weaves silk in Varanasi; one scarf is four days on her loom, and she sells by word of mouth. In an agent-run market she simply doesn't exist.

We asked: what if Meera had an agent too, one that speaks her language, knows her price, and is paid safely through PayPal?

## What it does

Mandix is an agent-to-agent bazaar. Every artisan gets an AI sales agent; every shopper can send an AI buying agent. The agents haggle, code keeps them honest, and PayPal holds the money until the work ships.

1. **List in a minute, in any language.** Meera adds a photo and a voice note in Hindi. Her agent writes the English listing, checks what similar products sell for, and she sets a list price plus a private floor. Publishing creates a PayPal catalog product.
2. **One sentence from the buyer.** Sarah in London types "silk scarf for my mum, under £90, by Dec 20". Her agent turns it into a mandate (budget, deadline, ship-to country) that she confirms once.
3. **Three negotiations at once, live.** Sarah's agent bargains with up to three sellers in parallel. The room streams every turn with a price chart per seller, showing what each agent proposed and what the engine allowed.
4. **One tap, money held.** Her agent recommends one deal with its reasons. Sarah approves in PayPal, which authorizes and holds the amount. Nothing is paid yet.
5. **Ship, then get paid.** Meera adds tracking. Mandix captures the payment, attaches tracking to the PayPal order, and pays Meera out.
6. **Problems handled by her agent.** If something's wrong, Sarah reports it. Meera's agent offers a refund within the limit Meera set and PayPal returns it at once; anything larger waits for Meera's tap.
7. **Built for the seller's world.** Meera follows every sale on a phone view in Hindi (or any of 11 languages) with rupee amounts, and can get WhatsApp alerts. A seller with no PayPal account creates one inside Mandix: PayPal's sign-up opens in a window over the app.

## How it works: the AI talks, code decides

The agents choose what to say and what to offer. A deterministic negotiation engine decides whether an offer is allowed, and only code ever touches money.

- Every agent turn passes the guardrail engine before it is saved, streamed or shown to the other side.
- The seller's floor and the buyer's ceiling are enforced on every turn. An offer past a limit is **blocked, not clamped**, so the limit itself never leaks through the price.
- A leak filter strips a seller's floor from any message before the buyer's agent reads it ("my floor is [withheld]").
- The other agent's words reach each model as untrusted data, never as instructions.
- Agents never get capture, refund or void as tools. No PayPal order exists without the buyer's tap, and refunds above the seller's cap need the seller's tap.
- The **attack test** proves it on screen: a hostile buyer injects instructions and each seller agent is made to fall for it. Every £1 offer is blocked by code and the leaked floor arrives as "[withheld]".

## PayPal integration (sandbox)

| What | PayPal API or tool | When |
| --- | --- | --- |
| Catalog product | Agent Toolkit `create_product` | Seller publishes |
| Create order (intent AUTHORIZE) | Orders v2 via the PayPal Server SDK (APIMatic) | Buyer taps Approve |
| Authorize and hold | `POST /v2/checkout/orders/{id}/authorize` | PayPal approval |
| Capture | `POST /v2/payments/authorizations/{id}/capture` | Seller adds tracking |
| Tracking | `POST /v2/checkout/orders/{id}/track` | Right after capture |
| Payout to seller | `POST /v1/payments/payouts` | After capture |
| Refund | `POST /v2/payments/captures/{id}/refund` | Agent proposal within cap, or seller's tap |
| Void / reauthorize | Payments v2 | Seller can't ship / needs more time |
| Seller sign-up | Partner Referrals (mini-browser) | Seller taps Connect PayPal |
| Webhooks | `verify-webhook-signature` | PayPal events |

Every call is logged and shown live in a docked "PayPal API calls" panel, so judges can watch the money move.

## How we built it

- **App:** one Next.js 15 and TypeScript app with Postgres (Drizzle), hosted on Render. Server-Sent Events stream the negotiation room.
- **Agents:** Claude (`claude-sonnet-5-5`) through the Anthropic SDK with structured output (Zod). It runs both sides of every negotiation, parses the buyer's mandate, writes listings from photos and voice, recommends deals, proposes refunds and checks damage photos with vision.
- **Speech:** OpenAI speech-to-text (`gpt-transcribe`) for seller voice notes, including Hindi.
- **Prices:** Channel3 comparable products for the seller's suggested range and the buyer's reference price.
- **Dashboard:** AG Grid and AG Charts for the seller dashboard and the live price charts.
- **Reliability:** if the model is unavailable or returns bad output twice, a rule-based turn takes over, still through the engine, so a negotiation never stalls.
- **Development:** built, tested (335 unit and 9 end-to-end tests) and deployed with Claude Code.

## Challenges we ran into

- **Capture timing.** PayPal captures most reliably within the 3-day honor period, so Mandix gives sellers a ship-by window, voids unshipped holds automatically so buyers are never charged, and lets slower sellers renew the hold.
- **Cross-border sandbox setup.** An India business account can't receive GBP, so the platform runs on a UK merchant; India sandbox seller sign-ups route into real KYC steps, so linking had to work even when sign-up stops early.
- **Dependable on camera.** Structured outputs, an engine that rejects bad turns and a rule-based fallback mean a model hiccup never freezes the demo.

## Accomplishments that we're proud of

- The full sandbox money flow works end to end: authorize, hold, capture, tracking, payout, refund and void.
- Three live agent negotiations in parallel, readable by a human as they happen.
- A prompt-injection attack visibly stopped by code, not by hoping the model behaves.
- A seller can go from no PayPal account and no listing to selling abroad without leaving Mandix.

## What we learned

- Let the model talk, but let code decide. Blocking (not clamping) offers keeps private limits from ever leaking.
- Between agents, prompt injection is a real threat; isolating each side's private data matters more than clever prompts.
- PayPal's authorize-then-capture flow is a natural escrow for handmade goods: the buyer is protected until it ships, the seller once it does.

## What's next

- Connect Mandix sellers to PayPal's agentic commerce services (Agent Ready, Store Sync) so they appear inside every AI shopping assistant.
- Marketplace payouts with platform fees, and onboarding in more languages.
- Real carrier tracking, and buyer budgets in more currencies.

## Try it

- **Live demo:** https://mandi-4pjw.onrender.com (click **Try the demo**). No account needed; everything is PayPal sandbox (test money only).
- **Video:** https://www.youtube.com/watch?v=IPY8oHCtNMA
- **Seller side:** one-click demo sellers at `/login`, then `/dashboard`, `/sell`, `/seller` and `/agent`.
- **Code and step-by-step judge guide:** https://github.com/teamthirtyeight/mandi
