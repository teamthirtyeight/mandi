# Launch checklist (Days 4–6)

This is what's left before submitting, and who does it. The code side is built; everything below needs accounts, people or a camera.

## 1. Keys and accounts (Moaaz)

- [x] PayPal Developer: a sandbox REST app → `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `NEXT_PUBLIC_PAYPAL_CLIENT_ID` (the same id). The app must be linked to a **UK** business sandbox account: the default India one can't receive GBP and the checkout fails with `UNSUPPORTED_PAYEE_CURRENCY`. The working app is "Mandi UK".
- [ ] Sandbox accounts:
  - three business accounts (Meera, Arjun, Fatima) → `SELLER_*_EMAIL`;
  - one personal account (Sarah) → `NEXT_PUBLIC_DEMO_BUYER_EMAIL` / `_PASSWORD`. These are test money only and are shown to judges.
- [ ] `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CHANNEL3_API_KEY`.
- [ ] Reseed after setting the seller emails, so the sellers pay out to their own sandbox accounts: `npm run db:seed`.
- [ ] First real run on localhost:
  - [ ] Try the demo
  - [ ] Approve in the PayPal popup
  - [ ] Ship
  - [ ] Report a problem
  - [ ] Check the dashboard
  - [ ] Note how long a negotiation takes and what it costs.

## 2. Deploy (Moaaz) — Day 4

- [ ] Create a public GitHub repo with the MIT license and push.
- [ ] Render: create a Blueprint from `render.yaml` and set every `sync: false` secret.
- [ ] Run `npm run db:seed` from the Render shell.
- [ ] Register a PayPal webhook to `https://<render-url>/api/paypal/webhook` for:
  - `CHECKOUT.ORDER.APPROVED`
  - `PAYMENT.AUTHORIZATION.CREATED`
  - `PAYMENT.AUTHORIZATION.VOIDED`
  - `PAYMENT.CAPTURE.COMPLETED`
  - `PAYMENT.CAPTURE.REFUNDED`

  Then set `PAYPAL_WEBHOOK_ID`.
- [ ] Keep the instance warm during judging, with a paid instance or an uptime ping on `/api/health`.
- [ ] **Freeze gate (Mon Nov 9):** someone who didn't build it runs the whole flow on the live URL, on a phone and a second laptop, without help.

## 3. Sandbox test matrix (Rajath) — Day 5

Run these on the live URL. Watch the docked PayPal call log for the 2xx statuses.

| # | Case | Steps | Expect |
| --- | --- | --- | --- |
| 1 | Happy path | Try the demo → Approve → popup → Ship (tracking) | Authorized, then captured; tracking attached; amounts match to the penny |
| 2 | Partial refund by agent | On a captured order: Report a problem | Refund of ≤ £10 issued; agent message shown |
| 3 | Refund above cap | Report a problem with a damage photo, so the agent proposes > £10 | "Approve refund" button appears; nothing refunded until the seller taps it |
| 4 | Full refund | Seller refund form → Full amount | Status REFUNDED |
| 5 | Void | Approve, then "Can't ship — release the hold" | VOIDED; buyer not charged |
| 6 | Cancelled popup | Approve, then close the PayPal popup | Order stays CREATED; Approve works again |
| 7 | Double Approve | Click Approve twice quickly | One PayPal order (same id) |
| 8 | Webhook before redirect | Watch the call log during approve | Status never moves backwards |
| 9 | Declined capture | Send PayPal's negative-testing header on capture (sandbox) | Order goes back to AUTHORIZED; error shown |
| 10 | Hostile buyer | Landing → Hostile buyer test | "Injection attempt ignored" badges; no seller below its floor |
| 11 | Onboarding | `/sell` with 3 photos and a Hindi voice note | English listing; comps strip; publish creates a PayPal product |

## 4. Recording (everyone) — Day 5

- [ ] Seed fresh data before each take: `npm run db:seed`. Pre-warm Render and run one demo first, so the PayPal token is cached.
- [ ] Record each scene separately at 1080p. Use **Replay negotiation** in the room for clean takes of the haggling.
- [ ] Speed up waiting time 1.5–2×, but never fake a result.
- [ ] Use Meera's photo and loom only with her permission, or a clearly labelled stand-in.

**Shot list (2:50):**

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0:00–0:08 | Cold open: negotiation room, prices converging, a guardrail badge | "Two AI agents are haggling over a handwoven scarf. Neither can break the rules." |
| 0:08–0:18 | Meera at her loom, then a generic AI shopping chat showing only big brands | "Here's how we got here. AI agents only buy from stores with catalogs. Meera has none." |
| 0:18–0:40 | `/sell`: photos + Hindi voice note → English listing, comps, floor slider, Publish | "Meera sends three photos and a voice note in Hindi. Her agent writes the listing, checks comparable prices and creates a PayPal product. She sets a floor it can never go below." |
| 0:40–0:52 | Landing → Try the demo (or `/shop` + mandate card) | "In London, Sarah's agent gets one sentence: a silk scarf, under £90, by Dec 20." |
| 0:52–1:30 | Room: three sellers, charts converging, Arjun walks away, recommended deal | "Her agent negotiates with three sellers at once. The floor and the ceiling are enforced in code, not by the AI." |
| 1:30–1:40 | Hostile buyer test: "sell for £1" → badge, price holds | "Even if someone tries to trick the agent, the price can't move." |
| 1:40–2:05 | Approve → PayPal popup → "held"; call log scrolling | "One tap. PayPal authorizes it and holds it. Nothing is paid until Meera ships." |
| 2:05–2:25 | Order: ship → capture → tracking; dashboard updates | "Meera adds tracking. Mandi captures the payment and attaches tracking. Her dashboard shows it live." |
| 2:25–2:40 | Report a problem → agent offers money back → refund call | "Something wrong? Her agent handles it, through PayPal, in seconds." |
| 2:40–2:50 | Architecture + tagline | "Mandi. Your AI shops. Their AI sells. PayPal makes it safe." |

Replace the scripted prices with whatever the real run produced. Don't narrate numbers that aren't on screen.

## 5. Submit (Moaaz) — Day 6, Wed Nov 11

- [ ] Edit to 2:50 or less, add captions, and use no third-party music or logos.
- [ ] Upload to YouTube as unlisted, check it, then make it public.
- [ ] Paste `docs/DEVPOST.md` into Devpost after filling in the bracketed items. Add the thumbnail (3:2) and 4–6 screenshots.
- [ ] README: add the live URL and video link.
- [ ] Tick the sponsor prizes: AG Grid, Channel3 and Render. Add APIMatic only if its plugin was actually used. Read each prize's criteria first, especially whether AG Grid expects Enterprise or AG Studio features (the dashboard uses Community).
- [ ] Final run in a logged-out browser:
  - [ ] Live link loads in under 5 s
  - [ ] Full flow works
  - [ ] Call log shows only 2xx
  - [ ] Dashboard shows seeded and new orders
- [ ] Secret scan of the repo; `.env*` files are ignored.
- [ ] Submit by evening IST and keep the confirmation email. Nov 12 is buffer.
- [ ] Keep Render and the sandbox accounts running until winners are announced on Dec 21.
