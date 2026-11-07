# Guardrails integration guide

> **Status:** this library is not connected to the app yet. The running app uses its own guardrails in `lib/engine/negotiation.ts` and `lib/orders/`. This branch only adds the library, and connecting it is a separate decision.

The app uses the `postgres` driver, while `db/operations.ts` uses `pg`. Both can run side by side with their own connections. `db/schema.sql` also needs reconciling with `lib/db/schema.ts`. Parts of this guide were written before the app existed, so check each step against the current code.

This guide shows how to connect `lib/guardrails` to Mandi's agents, API routes, database, and PayPal client.

- **For a plain-language overview:** [How the guardrails work](HOW-IT-WORKS.md)
- **For flow diagrams:** [Guardrails architecture](ARCHITECTURE.md)
- **For a working example:** [integration-flow.test.ts](db/__tests__/integration-flow.test.ts) runs this flow on real Postgres, with a fake model and a fake PayPal

Any name in these examples that the library doesn't export is a placeholder for code you'll write, such as `paypal`, `respond`, `saveTurn`, `stream`, `buildPrompt`, and `isDefiniteRejection`.

## 1. Set up

Install dependencies:

```bash
npm install
```

Add these to `.env`, which git ignores:

```text
ANTHROPIC_API_KEY=
DATABASE_URL=
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
```

Import from these two paths:

```ts
import { runGuardedTurn, createNegotiation, agentBrief } from "@/lib/guardrails";
import { reserveOrder, claimCapture, claimRefund } from "@/lib/guardrails/db/operations";
```

The `@/` alias must be set up in `tsconfig.json`, which `create-next-app` normally offers. Until then, use relative paths.

Only import these in server code, never in a client component. `money.ts` uses `node:crypto`, and floors must never reach the browser.

Create these once per server process, and share them across requests:

```ts
import pg from "pg";
import { CircuitBreaker, assertSandboxBaseUrl } from "@/lib/guardrails";

assertSandboxBaseUrl(process.env.PAYPAL_BASE_URL!); // Refuses to start against live PayPal.

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const breaker = new CircuitBreaker();
```

### Database

Add everything in [db/schema.sql](db/schema.sql) to the Drizzle schema, including its unique indexes and check constraints. They're the last line of defence if application code has a bug. Drizzle can share the same `pool`.

Also add these columns, which the engine needs but the safety operations don't use:

| Table | Columns |
|---|---|
| `listings` | `list_price`, `floor_price`, `currency`, `ship_by_days`, `transit_days` |
| `negotiations` | `fx_rate_numerator`, `fx_rate_denominator` |

## 2. Key concepts

### Money is in minor units

All amounts are whole numbers of the smallest unit, so £72.00 is `7200`. Use `formatMoney(7200, "GBP")` to display it. Non-integer prices are rejected.

### Every check returns a `Decision`

```ts
const decision = evaluateSomething(...);

switch (decision.verdict) {
  case "ALLOW":    // Proceed with decision.value.
  case "REWRITE":  // Proceed with decision.value, which replaced the proposal.
  case "RETRY":    // Ask the model once more. runGuardedTurn does this for you.
  case "ESCALATE": // Stop and ask a person.
  case "DENY":     // Stop. Show decision.reason, and log decision.rule.
}
```

### Money actions use three steps

1. **Claim** in the database, using `db/operations.ts`.
2. **Call PayPal**, sending the claim's `requestId` as the `PayPal-Request-Id` header.
3. **Record** the result.

Never hold a database transaction open during a PayPal call. Then handle the result:

| PayPal result | What to do |
|---|---|
| Success | Call the `complete` function |
| Definite rejection | Call the `release` function, where one exists |
| Unknown, such as a timeout | Retry with the same `requestId`, and don't release |

Before relying on the unknown-result rule, confirm in the sandbox that PayPal treats a repeated request ID as the same request.

## 3. Connect the model

The library calls any AI through this interface:

```ts
export interface AgentModel {
  complete<T>(request: ModelRequest<T>): Promise<T>;
}
```

Your implementation must:

- Send `request.system`, `request.user`, and a JSON schema from `request.schema`.
- Pass `request.signal` to the API call, so timeouts can cancel it.
- Validate the reply with `request.schema`.
- Throw `new ModelFailure(message, kind)` for recoverable failures.
- Let every other error throw, such as a bad API key.

| Failure | Kind |
|---|---|
| Timeout or aborted call | `"timeout"` |
| 429, 5xx, or connection failure | `"outage"` |
| Refusal, cut-off reply, invalid JSON, or schema mismatch | `"bad_output"` |

[eval/claude.ts](eval/claude.ts) is a working version using the Anthropic SDK, and you can adapt it for production. It's currently set to low effort and adds a spending cap for evaluations. If you use the Vercel AI SDK, keep the same interface.

**Don't send `temperature`.** The plan sets it to 0.4 and 0.2, but Claude Sonnet 5.5 returns a 400 for non-default values.

### Agent prompts

Every negotiation prompt must include these rules. See `SHARED_RULES` in [eval/agents.ts](eval/agents.ts) for tested wording:

- Reply in the required JSON format, with `priceMinor` in minor units.
- Never go past `yourLimitThisRoundMinor`.
- Write `{{price}}` for your own current price, and leave it out when walking away.
- Don't write amounts, percentage discounts, or the other side's price.
- Don't mention limits, budgets, rounds, or a final offer.
- Include `UNTRUSTED_DATA_RULE`, exported by the library.

### Agent tools

Check each agent's tools when building it:

```ts
const check = checkToolset("seller", Object.keys(sellerTools));
if (check.verdict !== "ALLOW") throw new Error(check.reason);
```

The allowlist in [tools.ts](tools.ts) uses the plan's tool names. If yours differ, update it, but never add capture, refund, order, or invoice tools.

Wrap any tool that acts on an order or seller, so those IDs come from the session and not the model:

```ts
const postTracking = scopeTool({
  name: "post_tracking",
  modelArgKeys: ["carrier", "trackingNumber"],
  bind: (ctx: { sellerId: string; orderId: string }) => ({ sellerId: ctx.sellerId, orderId: ctx.orderId }),
  authorize: async (ctx) => (await sellerOwnsOrder(ctx) ? allow("OWNER", "seller owns order", undefined) : deny("NOT_OWNER", "not this seller's order")),
  execute: async (args) => saveProposedTracking(args),
});

const outcome = await postTracking({ sellerId, orderId }, modelArguments);
```

`sellerOwnsOrder` and `saveProposedTracking` are yours to write. Tracking from an agent can't trigger a capture, because `claimCapture` escalates anything without `enteredBy: "seller"`.

## 4. Run a negotiation

Load the limits on the server. Never accept a floor or ceiling from the browser or an agent.

```ts
const state0 = createNegotiation({
  listMinor: listing.list_price,
  floorMinor: listing.floor_price,
  ceilingMinor: mandate.max_price,
  currency: "GBP",
  maxRounds: 6, // Optional.
});
```

If the floor is in another currency, convert it first. This rounds up in the seller's favour. Save the rate on the negotiation, so it can't change partway through:

```ts
const floorMinor = convertFloorUp(listing.floor_price, rateNumerator, rateDenominator);
```

Then run the turns:

```ts
const metrics = emptyMetrics();
let state = state0;
const history = [];

while (["OPEN", "OFFERED", "COUNTERED"].includes(state.status)) {
  const actor = state.nextActor;
  const prompt = buildPrompt(state, actor, history);

  const turn = await runGuardedTurn(model, state, actor, prompt, metrics, { breaker });

  state = turn.state;
  history.push({ actor, priceMinor: turn.event.finalMinor, message: turn.message });
  await saveTurn(negotiationId, turn);
  stream(negotiationId, turn);
}
```

`buildPrompt` should work like `buildTurnPrompt` in [eval/agents.ts](eval/agents.ts). You can only send it these values:

- `agentBrief(state, actor)`, which is the only source of negotiation numbers.
- `wrapUntrusted("counterparty_message", text)` for the other side's messages.
- `listingForBuyerAgent(listing)` for the buyer's view of a listing. It copies specific fields, so new columns stay private.
- `wrapUntrusted("channel3_data", text)` for Channel3 data.

Never put `state.limits` in a prompt. If the Vercel AI SDK or a logger captures prompts, they should only contain these values.

### What a turn returns

```ts
{
  state,   // Save this.
  message, // The checked message with the final price written in.
  event: {
    actor, round,
    proposedMinor,   // What the AI asked for. Observers only.
    finalMinor,      // The real price after guardrails.
    guardrailResult, // Rule name. Store in negotiation_turns.guardrail_result.
    verdict, status,
  },
  source: {
    action,  // "model" or "rules"
    message, // "model" or "backup"
    reason,  // Why backup was used, or null.
  },
}
```

Failures are handled for you: timeouts, retries, backup rules, and the circuit breaker. `runGuardedTurn` only throws for real faults, such as a bad API key, so catch those in the route.

### Rank deals

Exclude a listing before negotiating if it can't arrive on time:

```ts
if (!isDeliverable(shipByMs, transitDays, mandate.deadlineMs)) continue;
```

After the negotiations, score matches and rank them:

```ts
const { scores } = await scoreListings(
  model,
  { system: rerankSystemPrompt, user: promptWithWrappedListings },
  listingIds,
  { breaker },
);

const ranked = rankDeals(
  agreedDeals.map((deal) => ({
    negotiationId: deal.negotiationId,
    agreedMinor: deal.agreedMinor,
    referenceMinor: deal.referenceMinor,
    deliveryMs: deal.deliveryMs,
    deadlineMs: mandate.deadlineMs,
    matchQuality: scores[deal.listingId] ?? 0.5,
  })),
);
```

Scores are capped between 0 and 1, and deals that miss the deadline are removed. If the model fails, every listing gets 0.5, so price and delivery decide.

## 5. Connect the screens

| Screen | Send | Don't send |
|---|---|---|
| Other agent | `counterpartyView(event)` and `message` | `proposedMinor`, `guardrailResult`, `limits` |
| Sarah's screen | `counterpartyView(event)` and `message` | The floor and the seller's proposals |
| Meera's dashboard | Her own floor, plus `counterpartyView(event)` and `message` | Sarah's ceiling |
| Demo observer screen | The full `event`, to show clamps | `state.limits`, unless you deliberately show them in the demo |

The observer screen reveals proposed prices, so treat it as demo-only. Show a backup badge when `source.reason` isn't null.

## 6. Freeze the deal

Once `state.status` is `AGREED`, lock the exact terms:

```ts
const deal = freezeDeal({
  negotiationId,
  mandateId,
  listingId,
  sellerId,
  payeeEmail: seller.paypal_email,
  amountMinor: state.agreedMinor!,
  currency: "GBP",
  shipToCountry: mandate.ship_to_country,
  shipByMs,
  expiresAtMs: nowMs + 3 * 60 * 60 * 1000,
});

await pool.query(
  `UPDATE negotiations
      SET status = 'AWAITING_BUYER_APPROVAL', agreed_minor = $2, frozen_deal = $3
    WHERE id = $1`,
  [negotiationId, deal.amountMinor, JSON.stringify(deal)],
);
```

Send Sarah's browser the terms to display, along with `deal.hash`. The plan's PayPal order approval window is 3 hours, which is why this example expires then.

## 7. Sarah approves

```ts
const reserved = await reserveOrder(pool, { negotiationId, approvedHash, nowMs: Date.now() });

if (reserved.outcome === "denied") return respond(reserved.decision);

if (reserved.outcome === "existing" && reserved.paypalOrderId) {
  return respond({ paypalOrderId: reserved.paypalOrderId }); // A repeat click.
}

const { requestId, amount, payeeEmail } = reserved.params;
try {
  const created = await paypal.createOrder({ requestId, intent: "AUTHORIZE", amount, payeeEmail });
  return respond({ paypalOrderId: created.id });
} catch (error) {
  if (isDefiniteRejection(error)) await releaseReservation(pool, reserved.orderId);
  throw error;
}
```

Only use `approvedHash` from the browser. Always use `amount` and `payeeEmail` from `reserved.params`. They come from the frozen deal in the database.

**After the PayPal popup:**

```ts
// Sarah approved. The order ID must match the one saved for this deal.
const held = await paypal.authorize(paypalOrderId);
await recordAuthorization(pool, { orderId, paypalOrderId, authorizationId: held.authorizationId });

// Sarah cancelled.
await releaseReservation(pool, orderId);
```

Nothing automatically releases an order if Sarah closes the tab. Until that's built, the item stays reserved.

## 8. Meera ships

```ts
const shipment = await verifyShipment(verifier, { carrier, trackingNumber, shipToCountry: order.ship_to_country });
if (shipment.verdict !== "ALLOW") return respond(shipment);

const capture = await claimCapture(pool, {
  orderId,
  carrier,
  trackingNumber,
  enteredBy: "seller", // Only when Meera entered or confirmed it in her session.
  shipment: shipment.value,
  nowMs: Date.now(),
});
if (capture.verdict !== "ALLOW") return respond(capture);

try {
  const { authorizationId, requestId, amount } = capture.value;
  const result = await paypal.capture({ authorizationId, requestId, amount });
  await completeCapture(pool, orderId, result.id);
  await paypal.addTracking({
    paypalOrderId: order.paypal_order_id,
    captureId: result.id,
    carrier: capture.value.carrier,
    trackingNumber: capture.value.trackingNumber,
  });
} catch (error) {
  if (isDefiniteRejection(error)) await releaseCapture(pool, orderId);
  throw error;
}
```

Create `verifier` with `createSimulatedVerifier()` for the demo. It confirms any well-formed number, so label the result "simulated" using `orders.shipment_verified_by`. To use a real tracking service, implement `ShipmentVerifier`.

Supported carriers are `ROYAL_MAIL`, `INDIA_POST`, `DHL`, `FEDEX`, and `UPS`. To map them to PayPal's carrier codes, check PayPal's docs during integration.

## 9. Handle refunds

Wrap the complaint, and let the AI propose an amount:

```ts
const context = await loadRefundContext(pool, orderId);
if (!context) return respond({ error: "not found" });

const outcome = await decideRefund(
  model,
  { system: refundSystemPrompt, user: wrapUntrusted("buyer_complaint", complaint) },
  context.order,
  context.policy,
  { breaker },
);
```

Then act on the outcome:

```ts
switch (outcome.outcome) {
  case "rejected":
    return respond(outcome);
  case "ask_seller":
    return notifySeller(orderId, outcome); // No money moves until she approves.
  case "refund":
    return issueRefund(orderId, outcome.proposedMinor, "agent");
}
```

When Meera approves an exact amount in her session, call `issueRefund(orderId, amountMinor, "seller")`. Take `"seller"` only from her authenticated action, never from an agent.

```ts
async function issueRefund(orderId: string, amountMinor: number, approvedBy: "agent" | "seller") {
  const claim = await claimRefund(pool, {
    orderId,
    proposal: { amountMinor, currency: "GBP", approvedBy },
  });
  if (claim.verdict !== "ALLOW") return respond(claim);

  const { captureId, requestId, amount } = claim.value;
  try {
    const result = await paypal.refund({ captureId, requestId, amount });
    await completeRefund(pool, requestId, result.id);
  } catch (error) {
    if (isDefiniteRejection(error)) await releaseRefund(pool, requestId);
    throw error; // If the result is unknown, it stays PENDING. Retry with requestId.
  }
}
```

`decideRefund` is only a pre-check. `claimRefund` makes the real decision under a lock, so always call it, and use the currency stored on the order.

## 10. Map results to HTTP responses

This is a suggested mapping:

| Result | Status | Meaning |
|---|---|---|
| `ALLOW` | 200 | Done |
| `ESCALATE` | 202 | Waiting for a person |
| `DENY` for `DUPLICATE_ORDER`, `CAPTURE_IN_PROGRESS`, `OUT_OF_STOCK`, `TRACKING_REUSED` | 409 | Conflicts with current state |
| `DENY` for `TRACKING_INVALID`, `INVALID_AMOUNT` | 422 | Invalid input |
| `DENY` for `ORDER_NOT_FOUND`, `DEAL_NOT_FOUND` | 404 | Not found |
| Any other `DENY` | 403 | Not allowed |
| Other thrown errors, such as a bad API key | 503 | Show "service unavailable" |

Log every `rule`. Don't show `reason` to the other party in a negotiation.

## 11. Things you need to build

| Item | Owner | Notes |
|---|---|---|
| Authentication on every route | Routes | Confirm the caller owns the order, listing, or mandate. These functions don't check who's calling. |
| `isDefiniteRejection` | `lib/paypal` | True only for clear rejections, not timeouts or 5xx errors |
| Webhook signature checks and duplicate handling | `lib/paypal` | Webhooks may arrive before the browser's redirect |
| Rate limits and per-mandate AI budgets | Routes | Needed before the demo link goes public |
| Startup check for API credentials | Routes | Show "service unavailable" on failure |
| Manual listing form | Frontend | For when listing generation fails |
| Auto-void and abandoned reservation release | Shared | Not built yet |
| Hostile-buyer demo toggle | Frontend and engine | Use `ATTACKS` from [attacks/fixtures.ts](attacks/fixtures.ts) |

## 12. Test your integration

Before merging, run these:

```bash
npm test
```

```bash
npm run typecheck
```

With Docker running, test the database flows:

```bash
npm run test:db
```

Check the evaluation without a key:

```bash
npm run eval:guardrails -- --dry-run --runs 1
```

Run it with real prompts, which costs a small amount and needs `ANTHROPIC_API_KEY`:

```bash
npm run eval:guardrails -- --runs 5 --max-usd 2
```

The evaluation script uses stand-in prompts in [eval/agents.ts](eval/agents.ts), so change them to use the real `lib/agents` prompts once those exist. Fix any violation, and treat a backup rate above about 10% as a sign the prompts need work.

Add sandbox tests for these, which nothing has checked yet:

- A repeated `requestId` doesn't charge or refund twice.
- A partial and a later refund add up correctly in PayPal and the database.
- A declined capture can be retried.
- A webhook arriving before the redirect leaves the order correct.
- The real toolkit tool names match the allowlist.

## 13. Pre-merge checklist

- [ ] No prompt, log, or client response contains a floor, ceiling, or `state.limits`
- [ ] All outside text goes through `wrapUntrusted`
- [ ] All agent turns go through `runGuardedTurn`
- [ ] Agents have no capture, refund, order, or invoice tools
- [ ] Money routes use `db/operations.ts`, not `evaluate*` directly
- [ ] Amounts and payees come from the database, never the request body
- [ ] Every route checks that the caller owns the record
- [ ] `enteredBy: "seller"` and `approvedBy: "seller"` only come from the seller's own session
- [ ] No database transaction is open during a PayPal call
- [ ] Unknown PayPal results are retried, not released
- [ ] The Drizzle schema includes every constraint in `schema.sql`
- [ ] `temperature` isn't being sent
- [ ] Simulated shipment checks are labelled in the UI
