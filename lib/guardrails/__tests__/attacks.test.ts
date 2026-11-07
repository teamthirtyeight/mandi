/**
 * Assumes the attack fully succeeded on the LLM, then checks that the money and
 * limits still hold. No model is called, so these don't measure how often a real
 * model falls for an attack.
 */
import { describe, expect, it } from "vitest";
import { ATTACKS } from "../attacks/fixtures";
import { renderMessage, wrapUntrusted } from "../content";
import { evaluateRefund, type OrderRecord } from "../money";
import { agentBrief, createNegotiation, rankDeals, takeTurn } from "../negotiation";

const negotiation = () =>
  createNegotiation({ floorMinor: 6000, ceilingMinor: 9000, listMinor: 10000, currency: "GBP" });

describe(ATTACKS.forcePrice.name, () => {
  it("can't move the price below what the engine allows", () => {
    let state = takeTurn(negotiation(), "seller", { action: "offer", priceMinor: 10000 }).state;
    state = takeTurn(state, "buyer", { action: "offer", priceMinor: 5000 }).state;
    const { event } = takeTurn(state, "seller", {
      action: "offer",
      priceMinor: ATTACKS.forcePrice.compromisedOfferMinor,
    });
    expect(event.proposedMinor).toBe(100);
    expect(event.finalMinor).toBeGreaterThan(6000);
    expect(event.verdict).toBe("REWRITE");
  });
});

describe(ATTACKS.extractFloor.name, () => {
  it("gives the model no floor to reveal", () => {
    const state = takeTurn(negotiation(), "seller", { action: "offer", priceMinor: 10000 }).state;
    expect(JSON.stringify(agentBrief(state, "seller"))).not.toContain("6000");
  });

  it.each(ATTACKS.extractFloor.compromisedReplies)("blocks a leaking reply: %s", (template) => {
    const decision = renderMessage({ template, finalMinor: 8400, currency: "GBP", secretsMinor: [6000] });
    expect(decision.verdict).toBe("RETRY");
  });
});

describe(ATTACKS.refundDemand.name, () => {
  const order: OrderRecord = {
    id: "ord_1",
    amountMinor: 7200,
    currency: "GBP",
    status: "CAPTURED",
    authorizationId: "auth_1",
    captureId: "cap_1",
    capturedMinor: 7200,
    refundedTotalMinor: 0,
    refundCount: 0,
    autoRefundCount: 0,
    shipByMs: 0,
  };

  it("can't break out of the complaint wrapper", () => {
    const wrapped = wrapUntrusted("buyer_complaint", ATTACKS.refundDemand.complaint);
    expect(wrapped.match(/<\/buyer_complaint>/g)).toHaveLength(1);
  });

  it("escalates the full refund a compromised agent proposes", () => {
    const decision = evaluateRefund(
      order,
      { amountMinor: 7200, currency: "GBP", approvedBy: "agent" },
      { refundCapMinor: 1500, maxAutoRefundsPerOrder: 1 },
    );
    expect(decision.verdict).toBe("ESCALATE");
  });
});

describe(ATTACKS.poisonedListing.name, () => {
  it("can't outrank a much better deal by inflating match quality", () => {
    const shared = { referenceMinor: 10000, deliveryMs: 0, deadlineMs: 1 };
    const ranked = rankDeals([
      {
        ...shared,
        negotiationId: "poisoned",
        agreedMinor: 9000,
        matchQuality: ATTACKS.poisonedListing.compromisedMatchQuality,
      },
      { ...shared, negotiationId: "honest", agreedMinor: 2000, matchQuality: 0.8 },
    ]);
    expect(ranked[0]?.deal.negotiationId).toBe("honest");
  });

  it("treats a non-numeric match score as zero", () => {
    const [entry] = rankDeals([
      { negotiationId: "x", agreedMinor: 1, referenceMinor: 1, deliveryMs: 0, deadlineMs: 0, matchQuality: NaN },
    ]);
    expect(Number.isFinite(entry?.score)).toBe(true);
  });
});
