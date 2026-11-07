# Guardrails architecture

The technical flows in `lib/guardrails`, using the real function names. For usage, see the [README](README.md). For a plain-language overview, see [How the guardrails work](HOW-IT-WORKS.md).

> **Status:** this library is not connected to the app yet. The running app uses its own guardrails in `lib/engine/negotiation.ts` and `lib/orders/`. This branch only adds the library, and connecting it is a separate decision.

**Built vs planned:** solid boxes in the first diagram are this library, which is tested. Dashed boxes are app modules that exist but don't call this library yet. In the sequence diagrams, `Route`, `lib/paypal`, and PayPal show a possible integration and haven't run with this library.

## 1. Modules and dependencies

Arrows point from the caller to what it uses. Every guardrail module also uses `core.ts`, which holds the `Decision` type, verdict helpers, and money formatting, so those arrows are left out.

```mermaid
flowchart LR
    subgraph planned["App modules, not connected yet"]
        routes["app/api routes"]
        agents["lib/agents"]
        engine["lib/engine"]
        ppclient["lib/paypal"]
    end

    subgraph guardrails["lib/guardrails"]
        turn["turn.ts<br/>runGuardedTurn, guardedCall,<br/>CircuitBreaker, decideRefund,<br/>scoreListings"]
        negotiation["negotiation.ts<br/>takeTurn, roundLimit,<br/>agentBrief, ruleBasedTurn,<br/>counterpartyView, rankDeals"]
        content["content.ts<br/>wrapUntrusted, renderMessage,<br/>listingForBuyerAgent"]
        tools["tools.ts<br/>checkToolset, scopeTool"]
        money["money.ts<br/>freezeDeal, evaluateCreateOrder,<br/>evaluateCapture, evaluateRefund"]
        shipment["shipment.ts<br/>verifyShipment,<br/>ShipmentVerifier"]
        operations["db/operations.ts<br/>reserveOrder, claimCapture,<br/>claimRefund"]
    end

    subgraph external["External services"]
        llm["Anthropic API"]
        postgres[("Postgres")]
        paypal["PayPal REST API"]
        carrier["Carrier API or<br/>simulated verifier"]
    end

    engine --> turn
    engine --> negotiation
    agents --> content
    agents --> tools
    routes --> operations
    routes --> shipment
    routes --> turn
    routes --> ppclient
    ppclient --> paypal
    turn -- "AgentModel interface" --> llm
    turn --> negotiation
    turn --> content
    turn --> money
    operations --> money
    operations --> postgres
    shipment --> money
    shipment -- "ShipmentVerifier interface" --> carrier

    classDef notBuilt stroke-dasharray:5 5,fill:#f8fafc,stroke:#64748b,color:#0f172a
    class routes,agents,engine,ppclient notBuilt
```

## 2. Decision contract

Every check is a pure function that returns the same type. Only `ALLOW` and `REWRITE` carry a value, so callers can't proceed on a blocked action without handling it.

```mermaid
flowchart LR
    input["Action + current state"] --> rule["Pure guardrail function"]
    rule --> decision{"Decision.verdict"}
    decision -- "ALLOW" --> proceed["Use decision.value"]
    decision -- "REWRITE" --> replaced["Use decision.value,<br/>which replaces the proposal"]
    decision -- "RETRY" --> retry["Ask the model once more,<br/>then ruleBasedTurn()"]
    decision -- "ESCALATE" --> person["Stop and ask a person"]
    decision -- "DENY" --> stop["Stop"]
    decision -. "decision.rule" .-> audit["negotiation_turns.guardrail_result<br/>or audit log"]
```

## 3. Negotiation turn: `runGuardedTurn`

```mermaid
flowchart TD
    start(["runGuardedTurn(model, state, actor, prompt, metrics, options)"]) --> budget{"Turn budget left?<br/>default 30s"}
    budget -- "No" --> rules
    budget -- "Yes" --> breaker{"breaker.allowsCall()"}
    breaker -- "false" --> rules
    breaker -- "true" --> modelCall["guardedCall: model.complete()<br/>default 20s, AbortSignal on timeout"]

    modelCall --> outcome{"Result"}
    outcome -- "Other error, such as a bad API key" --> fatal(["Throws to the caller"])
    outcome -- "ModelFailure:<br/>timeout or outage" --> tripped["breaker.recordOutage()"]
    outcome -- "ModelFailure:<br/>bad_output or refusal" --> answered["breaker.recordResponse()"]
    outcome -- "Valid TurnOutput" --> evaluate["takeTurn:<br/>evaluateTurn(state, actor, turn)"]
    tripped --> attempts
    answered --> attempts
    attempts{"Attempts < 2?"}
    attempts -- "Yes" --> budget
    attempts -- "No" --> rules

    evaluate --> verdict{"Verdict"}
    verdict -- "RETRY<br/>INVALID_PRICE, NO_BACKTRACKING" --> attempts
    verdict -- "DENY<br/>OUT_OF_TURN, TERMINAL_STATE" --> attempts
    verdict -- "ALLOW" --> apply["applyTurn: new state,<br/>checks for crossed offers"]
    verdict -- "REWRITE<br/>SELLER_ROUND_LIMIT, BUYER_ROUND_LIMIT" --> apply

    apply --> render["renderMessage(template, finalMinor, secretsMinor)"]
    render --> safe{"Message safe?"}
    safe -- "ALLOW" --> result
    safe -- "RETRY" --> regen["One more model call,<br/>only its message is used"]
    regen --> again{"Message safe?"}
    again -- "ALLOW" --> result
    again -- "RETRY or no reply" --> plain["fallbackMessage()"]
    plain --> result

    rules["ruleBasedTurn(), then takeTurn()<br/>source.action = rules"] --> plain

    result(["Returns { state, event, message, source }"]) --> view["counterpartyView(event)<br/>removes proposedMinor and rule"]
    view --> other["Sent to the other agent"]
```

### What the model receives

```mermaid
flowchart LR
    limits["state.limits<br/>floorMinor, ceilingMinor, listMinor"] --> roundLimit["roundLimit(state, actor)"]
    last["sellerLastMinor, buyerLastMinor,<br/>round, maxRounds"] --> roundLimit
    roundLimit --> brief["agentBrief()<br/>yourLimitThisRoundMinor"]
    last --> brief
    brief --> prompt["Prompt"]
    untrusted["Counterparty messages, listings,<br/>complaints, Channel3 data"] --> wrap["wrapUntrusted(): NFKC, strip invisible<br/>characters, escape tags, truncate"]
    wrap --> prompt
    limits -. "never included" .-x prompt
```

`roundLimit` per actor:

| Case | Seller | Buyer |
|---|---|---|
| First move | `listMinor` | 80% of `ceilingMinor`, at least 1 |
| Normal round | Last offer minus 40% of the gap to the floor | Last offer plus 40% of the gap to the ceiling |
| Final round, floor ≤ ceiling | `min(last offer, midpoint)` | The ask if ≤ ceiling, else `max(last offer, midpoint)` |
| Final round, floor > ceiling | Normal round rule | Normal round rule |

## 4. State machines

### Negotiation

```mermaid
stateDiagram-v2
    [*] --> OPEN: createNegotiation
    OPEN --> OFFERED: seller opens at list price
    OPEN --> WALKED_AWAY: walk_away
    OFFERED --> COUNTERED: buyer offers
    COUNTERED --> COUNTERED: offers that don't cross
    OFFERED --> AGREED: buyer accepts or crosses
    COUNTERED --> AGREED: offers cross or accept
    OFFERED --> WALKED_AWAY: walk_away
    COUNTERED --> WALKED_AWAY: walk_away
    OFFERED --> EXPIRED: final round, no cross
    COUNTERED --> EXPIRED: final round, no cross
    AGREED --> AWAITING_BUYER_APPROVAL: engine stores freezeDeal result
    AWAITING_BUYER_APPROVAL --> ORDERED: reserveOrder
    ORDERED --> AWAITING_BUYER_APPROVAL: releaseReservation
    WALKED_AWAY --> [*]
    EXPIRED --> [*]
```

### Order

```mermaid
stateDiagram-v2
    [*] --> CREATED: reserveOrder, stock minus 1
    CREATED --> [*]: releaseReservation, stock plus 1
    CREATED --> AUTHORIZED: recordAuthorization
    AUTHORIZED --> SHIPPED: claimCapture, sets lease and tracking
    SHIPPED --> SHIPPED: releaseCapture, or retry after lease expiry
    SHIPPED --> CAPTURED: completeCapture
    CAPTURED --> PARTIALLY_REFUNDED: claimRefund, partial
    CAPTURED --> REFUNDED: claimRefund, full
    PARTIALLY_REFUNDED --> PARTIALLY_REFUNDED: claimRefund, partial
    PARTIALLY_REFUNDED --> REFUNDED: claimRefund, remainder
    PARTIALLY_REFUNDED --> CAPTURED: releaseRefund, total back to 0
    REFUNDED --> PARTIALLY_REFUNDED: releaseRefund, some remains
    REFUNDED --> CAPTURED: releaseRefund, total back to 0
```

`APPROVED` and `VOIDED` are in the schema, but no operation sets them yet. `recordAuthorization` also accepts `APPROVED` as a starting state. `BLOCKED_BY_GUARDRAIL` is a valid negotiation status from the plan, and nothing sets it yet.

## 5. Money flows

Every flow uses the same pattern, so a transaction is never held open during a network call:

1. Lock the rows, run the pure rule, and write the claim in one transaction.
2. Call PayPal with a deterministic `PayPal-Request-Id`.
3. Record the result, or release the claim if PayPal definitely rejected it.

### Order creation

```mermaid
sequenceDiagram
    autonumber
    participant Route as Route
    participant Ops as db/operations
    participant Money as money.ts
    participant DB as Postgres
    participant PP as lib/paypal and PayPal

    Route->>Ops: reserveOrder(negotiationId, approvedHash, nowMs)
    Ops->>DB: BEGIN, lock negotiations row FOR UPDATE
    Ops->>DB: SELECT order for this negotiation
    alt Order already exists
        Ops->>DB: COMMIT
        Ops-->>Route: existing, with the same params and paypalOrderId
    else No order yet
        Ops->>DB: Lock listings row FOR UPDATE, read mandate and seller
        Ops->>Money: evaluateCreateOrder(deal, hash, stock, mandate, ...)
        alt DENY
            Money-->>Ops: DENY, such as OUT_OF_STOCK
            Ops->>DB: COMMIT with no changes
            Ops-->>Route: denied
        else ALLOW
            Money-->>Ops: params, requestId = order-negotiationId
            Ops->>DB: stock - 1, INSERT order CREATED, negotiation ORDERED, COMMIT
            Ops-->>Route: reserved
            Route->>PP: POST /v2/checkout/orders, intent AUTHORIZE
            alt PayPal rejects, or buyer cancels the popup
                Route->>Ops: releaseReservation(orderId)
                Ops->>DB: DELETE order, stock + 1, negotiation AWAITING_BUYER_APPROVAL
            else Buyer approves
                Route->>PP: POST /v2/checkout/orders/ID/authorize
                Route->>Ops: recordAuthorization(orderId, paypalOrderId, authorizationId)
                Ops->>DB: UPDATE order AUTHORIZED
            end
        end
    end
```

Locks are always taken in the order negotiation, then listing, so simultaneous buyers queue rather than deadlock.

### Capture

```mermaid
sequenceDiagram
    autonumber
    participant Route as Route
    participant Ship as shipment.ts
    participant Carrier as ShipmentVerifier
    participant Ops as db/operations
    participant DB as Postgres
    participant PP as lib/paypal and PayPal

    Route->>Ship: verifyShipment(verifier, carrier, number, country)
    Ship->>Ship: normalizeTracking, DENY if invalid
    Ship->>Carrier: verify(query), default limit 10s
    alt Not found, wrong country, failed, or timed out
        Carrier-->>Ship: Evidence or failure
        Ship-->>Route: ESCALATE, a person reviews
    else Confirmed
        Carrier-->>Ship: Confirmed evidence
        Ship-->>Route: ALLOW, ConfirmedShipment
        Route->>Ops: claimCapture(orderId, tracking, enteredBy, shipment)
        Ops->>DB: BEGIN, lock orders row FOR UPDATE
        Ops->>Ops: Check capture lease, then evaluateCapture()
        alt Blocked
            Ops->>DB: COMMIT with no changes
            Ops-->>Route: DENY or ESCALATE
        else Allowed
            Ops->>DB: UPDATE SHIPPED, tracking, lease 60s, COMMIT
            Note over Ops,DB: Unique index violation becomes TRACKING_REUSED
            Ops-->>Route: ALLOW, requestId = capture-authorizationId
            Route->>PP: POST /v2/payments/authorizations/ID/capture
            alt Captured
                Route->>Ops: completeCapture(orderId, captureId)
                Ops->>DB: UPDATE CAPTURED, captured_minor, clear lease
                Route->>PP: POST /v2/checkout/orders/ID/track
            else PayPal definitely declined
                Route->>Ops: releaseCapture(orderId)
            else Result unknown
                Note over Route,PP: Keep the claim, retry with the same request ID
            end
        end
    end
```

### Refund

```mermaid
sequenceDiagram
    autonumber
    participant Route as Route
    participant Turn as turn.ts
    participant LLM as AgentModel
    participant Ops as db/operations
    participant DB as Postgres
    participant PP as lib/paypal and PayPal
    actor Seller

    Route->>Turn: decideRefund(model, prompt, order, policy)
    Note over Route,Turn: prompt holds wrapUntrusted("buyer_complaint", text)
    Turn->>LLM: guardedCall: propose refundMinor
    alt Model failed, or no usable amount
        Turn-->>Route: ask_seller
    else Usable amount
        LLM-->>Turn: refundMinor
        Turn->>Turn: evaluateRefund() pre-check, no lock
        Turn-->>Route: refund, ask_seller, or rejected
    end

    alt Outcome is ask_seller
        Route->>Seller: Show the request
        Seller-->>Route: Approves an exact amount
        Route->>Ops: claimRefund(approvedBy = seller)
    else Outcome is refund
        Route->>Ops: claimRefund(approvedBy = agent, proposedMinor)
    end

    Ops->>DB: BEGIN, lock orders row FOR UPDATE, read cap from listing
    Ops->>Ops: evaluateRefund() again, now under the lock
    alt Blocked
        Ops->>DB: COMMIT with no changes
        Ops-->>Route: DENY or ESCALATE
    else Allowed
        Ops->>DB: UPDATE totals and status, INSERT refund PENDING, COMMIT
        Ops-->>Route: ALLOW, requestId = refund-captureId-count
        Route->>PP: POST /v2/payments/captures/ID/refund
        alt Refunded
            Route->>Ops: completeRefund(requestId, paypalRefundId)
        else PayPal definitely rejected
            Route->>Ops: releaseRefund(requestId)
            Note over Ops,DB: Restores the totals, never reuses the request ID
        else Result unknown
            Note over Route,PP: Stays PENDING, retry with the same request ID
        end
    end
```

`decideRefund` runs without a lock, so its answer is only a pre-check. The check inside `claimRefund` is the one that counts. An `ask_seller` outcome on an agent proposal must not call `claimRefund` until the seller has approved.

## 6. Database protections

| Protection | Stops | Where |
|---|---|---|
| `SELECT ... FOR UPDATE` | Two requests passing a check at the same time | `db/operations.ts` |
| `orders.negotiation_id UNIQUE` | Two orders for one deal | `db/schema.sql` |
| Partial unique index on `orders.tracking_number` | One tracking number releasing two payments | `db/schema.sql` |
| `CHECK (stock >= 0)` | Overselling | `db/schema.sql` |
| `CHECK (refunded_total_minor <= captured_minor)` | Refunding more than was captured | `db/schema.sql` |
| `refunds.request_id PRIMARY KEY` | Reusing a refund's request ID | `db/schema.sql` |
| `capture_lease_until` | Two captures in flight, and a crash blocking retries forever | `db/operations.ts` |

## 7. Failure handling

| Failure | `FailureKind` | Counts toward breaker | Negotiation turn | Refund | Ranking |
|---|---|---|---|---|---|
| Call exceeds time limit | `timeout` | Yes | Retry, then rules | `ask_seller` | Neutral scores |
| 429, 5xx, or connection failure | `outage` | Yes | Retry, then rules | `ask_seller` | Neutral scores |
| Refusal, invalid JSON, or schema mismatch | `bad_output` | No, and it resets the count | Retry, then rules | `ask_seller` | Neutral scores |
| Breaker open, default 30s after 3 outages | `circuit_open` | No | Rules immediately | `ask_seller` | Neutral scores |
| Bad API key or invalid request | Not a `ModelFailure` | No | Throws | Throws | Throws |
