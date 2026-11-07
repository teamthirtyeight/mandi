# Guardrails

> **Status:** this library is not connected to the app yet. The running app uses its own guardrails in `lib/engine/negotiation.ts` and `lib/orders/`. This branch only adds the library, and connecting it is a separate decision.

The LLM proposes. This code decides. Agents never call PayPal money endpoints, and they never see the seller's floor or the buyer's ceiling.

New to this? Start with [How the guardrails work](HOW-IT-WORKS.md), a plain-language guide. [Guardrails architecture](ARCHITECTURE.md) has the technical flow diagrams, and the [integration guide](INTEGRATION.md) shows how to connect everything.

Every check is a pure function that returns the same `Decision`, with a `verdict`, `rule`, and `reason`:

| Verdict | What the caller does |
|---|---|
| `ALLOW` | Proceed using `decision.value` |
| `REWRITE` | Proceed using `decision.value`, which replaces what the agent proposed |
| `RETRY` | Ask the model once more, then use the fallback |
| `ESCALATE` | Stop and ask a person |
| `DENY` | Stop |

Save `rule` to `negotiation_turns.guardrail_result` or the audit log. Import from `lib/guardrails` on the server only, because `money.ts` uses `node:crypto`.

## Modules

| File | Covers | Main exports |
|---|---|---|
| `negotiation.ts` | Round limits, no backtracking, agreement, fallback, deal ranking | `createNegotiation`, `agentBrief`, `takeTurn`, `ruleBasedTurn`, `counterpartyView`, `isDeliverable`, `rankDeals` |
| `money.ts` | Frozen deals, order, capture, and refund checks | `freezeDeal`, `evaluateCreateOrder`, `evaluateCapture`, `evaluateRefund`, `convertFloorUp`, `assertSandboxBaseUrl` |
| `content.ts` | Untrusted text, price rendering, leak checks, buyer's listing view | `wrapUntrusted`, `UNTRUSTED_DATA_RULE`, `renderMessage`, `fallbackMessage`, `listingForBuyerAgent` |
| `tools.ts` | Agent tool allowlists and server-bound arguments | `checkToolset`, `scopeTool` |
| `turn.ts` | Time limits, outage handling, full agent turns, and refund and ranking fallbacks | `runGuardedTurn`, `decideRefund`, `scoreListings`, `CircuitBreaker`, `guardedCall` |
| `shipment.ts` | Pluggable shipment check, with a simulated carrier for the demo | `verifyShipment`, `createSimulatedVerifier`, `ShipmentVerifier` |
| `db/operations.ts` | Money actions that are safe under simultaneous requests. Import this path directly, as it needs `pg` | `reserveOrder`, `claimCapture`, `claimRefund`, and their complete and release functions |
| `attacks/` | Attack inputs for the tests and the hostile-buyer demo | `ATTACKS` |

## Using it

### Negotiation turn

```ts
// Put agentBrief() and wrapUntrusted() text in the prompt, never state.limits.
// The agent writes {{price}} instead of an amount.
const prompt = { system, user: buildUserPrompt(agentBrief(state, "seller"), lastMessage) };

const result = await runGuardedTurn(model, state, "seller", prompt, metrics, { breaker });
state = result.state;
```

`runGuardedTurn` asks the model, checks the action, retries once, falls back to rules, and renders the message. `model` is any `AgentModel`; `eval/claude.ts` shows one for the Anthropic SDK.

Send the other agent `counterpartyView(result.event)` and `result.message`. Use `result.source` for the UI's backup badge and for logs.

The split screen shows both `proposedMinor` and `finalMinor`, so treat it as a demo-only observer view. A buyer-facing screen should get `counterpartyView` only.

### When the model fails

| Situation | What happens | `result.source.reason` or outcome |
|---|---|---|
| No reply within 20 seconds | The call stops, and the turn retries or uses rules | `timeout` |
| A turn reaches 30 seconds | Backup rules finish the turn | `turn_budget` |
| Rate limits, server errors, or connection failures | The turn retries or uses rules | `outage` |
| 3 outages in a row | Model calls are skipped for 30 seconds, then tried again | `circuit_open` |
| A refusal or unusable reply | The turn retries or uses rules | `bad_output` |
| An invalid offer, twice | Backup rules finish the turn | `rejected_offer` |
| An unsafe message, twice | The action stays, with a plain message | `rejected_message` |
| A refund call fails or gives no usable amount | Meera decides, and nothing is refunded automatically | `decideRefund` returns `ask_seller` |
| A ranking call fails | Listings get a neutral score, so price and delivery decide | `scoreListings` sets `usedBackup` |

Create one `CircuitBreaker` per server and pass it to every call. Refusals don't count toward it, so a hostile user can't provoke them to switch the AI off for everyone.

A bad API key or invalid request is a real fault, so it throws rather than using backup rules. The app needs to catch it and show a "service unavailable" message, ideally after a startup check. If listing generation fails, the app should show a form so the seller can write the listing.

### Payment service

```ts
assertSandboxBaseUrl(process.env.PAYPAL_BASE_URL!); // At startup.

const decision = evaluateRefund(order, proposal, policy);
if (decision.verdict === "ALLOW") {
  // Use decision.value.requestId as the PayPal-Request-Id header.
  // Save decision.value.next to the order.
}
```

Run each money check and its database update in one transaction. A plain check followed by a separate update can let two parallel refunds both pass.

### Agent tools

Call `checkToolset(role, toolNames)` when building each agent, and throw on `DENY`. Wrap any tool that takes an order or seller ID with `scopeTool`, so those IDs come from the session and not from the model.

### Money actions and the database

Simultaneous requests are handled by `db/operations.ts`, which runs each money rule and its update as one locked step. Don't call the `evaluate*` functions directly from a route. Don't hold a transaction open during a PayPal call. Each action follows the same pattern:

| Action | Claim first | Call PayPal, then record | If PayPal definitely rejects it |
|---|---|---|---|
| Buyer approves | `reserveOrder` | `recordAuthorization` | `releaseReservation` |
| Seller ships | `verifyShipment`, then `claimCapture` | `completeCapture` | `releaseCapture` |
| Refund | `claimRefund` | `completeRefund` | `releaseRefund` |

If the result is unknown, such as after a timeout, don't release. Retry with the same `requestId`, so PayPal can treat it as the same request. Check that behaviour in the sandbox during integration.

`reserveOrder` returns `existing` for a repeat click. Use its `paypalOrderId`, or retry PayPal with its `params` if that's still null. Call `releaseReservation` when the buyer cancels the PayPal popup, or the item stays reserved.

### Shipment check

`claimCapture` requires a confirmed result from `verifyShipment`. For the demo, use `createSimulatedVerifier()`. It confirms any well-formed number, so it proves nothing about a real parcel. The order's `shipment_verified_by` column records `simulated`, so show that label in the UI. To use a real tracking service later, implement the `ShipmentVerifier` interface.

Say "paid when the seller ships", not "after delivery".

## Required schema

[db/schema.sql](db/schema.sql) lists the tables, columns, and constraints these operations rely on. The `lib/db` Drizzle schema must include them, including the unique indexes and check constraints.

The negotiation engine also needs `ship_by_days` and `transit_days` on `listings`, and `fx_rate_numerator` and `fx_rate_denominator` on `negotiations`.

## Limits

- **`content.ts` is a best-effort filter.** It catches mistakes and simple attacks, but creative wording can get through. The enforced limits are in `negotiation.ts` and `money.ts`.
- **Shipment checks are simulated.** A made-up number in a valid format still passes, because real carrier lookups are out of scope for the hackathon. A real lookup still wouldn't prove the parcel holds the right item.
- **Attack tests call no model.** They assume the model was fully compromised and check that the limits still hold. They don't show how often a real model resists an attack.
- **The tool allowlist uses the plan's tool names.** Check it against the real PayPal Agent Toolkit names during integration.
- **Not built yet:** rate limits, LLM budgets for the app, and auto-void of expired holds or abandoned reservations.

## Tests

```bash
npm run test:guardrails
```

The database tests skip themselves there. To run them, start Docker, then run this. It starts a temporary Postgres, tests against it, and removes it:

```bash
npm run test:db
```

## Real-model evaluation

This runs negotiations, attacks, refunds, and ranking against `claude-sonnet-5-5`, using stand-in prompts based on the build plan. It reports two things separately:

- **Violations:** a guardrail failed. This must be zero, and any violation makes the command exit with code 1.
- **Model behaviour:** deal rate, how often the model fell for an attack, and how often the fallbacks ran. These inform tuning, but aren't pass or fail.

Check it offline first, with a fully compromised fake model. This needs no key:

```bash
npm run eval:guardrails -- --dry-run
```

For a real run, copy `.env.example` to `.env` and add your key. Git ignores `.env`. Start with one run per scenario:

```bash
npm run eval:guardrails -- --runs 1
```

Then run the full set:

```bash
npm run eval:guardrails -- --runs 5 --max-usd 2
```

New calls stop once `--max-usd` is reached, and calls already in flight can go slightly over. The cost is an estimate at Sonnet 5.5 rates and doesn't reprice calls served by a fallback model. Results are saved to `eval-results/`, which git ignores.

Exit codes: `0` no violations, `1` a guardrail violation, `2` the run didn't finish.

**Sonnet 5.5 note:** non-default `temperature` values return a 400, so the plan's temperature settings of 0.4 and 0.2 must be removed.
