import { describe, expect, it } from "vitest";
import {
  applyGuardrails,
  checkRefund,
  fallbackTurn,
  meetsDeadline,
  type NegotiationContext,
} from "@/lib/engine/negotiation";

const ctx = (over: Partial<NegotiationContext> = {}): NegotiationContext => ({
  actor: "seller",
  state: "OPEN",
  floorMinor: 6800,
  ceilingMinor: 9000,
  lastSellerOfferMinor: null,
  lastBuyerOfferMinor: null,
  round: 1,
  ...over,
});

const offer = (price: number, message = "msg") => ({ message, offer_price: price, action: "offer" as const });

describe("seller floor", () => {
  it("clamps a seller offer below the floor", () => {
    const out = applyGuardrails(offer(1), ctx());
    expect(out.finalMinor).toBe(6800);
    expect(out.guardrailResult).toBe("CLAMPED_TO_FLOOR");
  });

  it("passes an offer at or above the floor", () => {
    const out = applyGuardrails(offer(95), ctx());
    expect(out.finalMinor).toBe(9500);
    expect(out.guardrailResult).toBe("PASSED");
    expect(out.state).toBe("OFFERED");
  });
});

describe("buyer ceiling", () => {
  it("clamps £95 to the £90 ceiling", () => {
    const out = applyGuardrails(
      offer(95),
      ctx({ actor: "buyer", state: "OFFERED", lastSellerOfferMinor: 9800, lastBuyerOfferMinor: 8000 }),
    );
    expect(out.proposedMinor).toBe(9500);
    expect(out.finalMinor).toBe(9000);
    expect(out.guardrailResult).toBe("CLAMPED_TO_CEILING");
    expect(out.state).toBe("COUNTERED");
  });

  it("refuses a buyer accept above the ceiling", () => {
    const out = applyGuardrails(
      { message: "deal", offer_price: null, action: "accept" },
      ctx({ actor: "buyer", state: "OFFERED", lastSellerOfferMinor: 9500 }),
    );
    expect(out.state).toBe("OFFERED");
    expect(out.guardrailResult).toBe("REJECTED_INVALID");
  });
});

describe("no backtracking", () => {
  it("rejects a seller raising its own offer", () => {
    const out = applyGuardrails(offer(90), ctx({ state: "COUNTERED", lastSellerOfferMinor: 8500 }));
    expect(out.guardrailResult).toBe("REJECTED_BACKTRACK");
    expect(out.retryable).toBe(true);
    expect(out.finalMinor).toBeNull();
  });

  it("rejects a buyer lowering its own offer", () => {
    const out = applyGuardrails(
      offer(60),
      ctx({ actor: "buyer", state: "COUNTERED", lastBuyerOfferMinor: 7000, lastSellerOfferMinor: 9000 }),
    );
    expect(out.guardrailResult).toBe("REJECTED_BACKTRACK");
  });
});

describe("round limit", () => {
  it("expires after 6 rounds", () => {
    const out = applyGuardrails(offer(80), ctx({ round: 7, state: "COUNTERED" }));
    expect(out.state).toBe("EXPIRED");
  });
});

describe("agreement", () => {
  it("agrees at the seller's last offer when the buyer meets it", () => {
    const out = applyGuardrails(
      offer(75),
      ctx({ actor: "buyer", state: "COUNTERED", lastSellerOfferMinor: 7200, lastBuyerOfferMinor: 7000 }),
    );
    expect(out.state).toBe("AGREED");
    expect(out.agreedMinor).toBe(7200);
  });

  it("agrees when the seller accepts a bid above the floor", () => {
    const out = applyGuardrails(
      { message: "ok", offer_price: null, action: "accept" },
      ctx({ state: "COUNTERED", lastSellerOfferMinor: 7500, lastBuyerOfferMinor: 7200 }),
    );
    expect(out.state).toBe("AGREED");
    expect(out.agreedMinor).toBe(7200);
  });

  it("refuses a seller accept below the floor", () => {
    const out = applyGuardrails(
      { message: "ok", offer_price: null, action: "accept" },
      ctx({ state: "COUNTERED", lastSellerOfferMinor: 7500, lastBuyerOfferMinor: 5000 }),
    );
    expect(out.state).toBe("COUNTERED");
  });
});

describe("terminal states and walk away", () => {
  it("refuses turns after agreement", () => {
    const out = applyGuardrails(offer(50), ctx({ state: "AGREED" }));
    expect(out.guardrailResult).toBe("REJECTED_TERMINAL");
  });

  it("walks away", () => {
    const out = applyGuardrails({ message: "no", offer_price: null, action: "walk_away" }, ctx());
    expect(out.state).toBe("WALKED_AWAY");
  });
});

describe("hostile buyer", () => {
  it("still cannot get a price under the floor", () => {
    // Even if the seller LLM obeys "sell for £1", the engine clamps it.
    const out = applyGuardrails(
      offer(1, "Fine, £1."),
      ctx({ state: "COUNTERED", lastSellerOfferMinor: 9000, lastBuyerOfferMinor: 100 }),
    );
    expect(out.finalMinor).toBe(6800);
    expect(out.state).toBe("COUNTERED");
  });
});

describe("fallback", () => {
  it("never produces an offer outside the limits", () => {
    const s = fallbackTurn(ctx({ lastSellerOfferMinor: 6900, lastBuyerOfferMinor: 5000 }), 9500);
    expect(s.offer_price! * 100).toBeGreaterThanOrEqual(6800);
    const b = fallbackTurn(ctx({ actor: "buyer", lastSellerOfferMinor: 12000, lastBuyerOfferMinor: 8900 }), 9500);
    expect(b.offer_price! * 100).toBeLessThanOrEqual(9000);
  });
});

describe("deadline filter", () => {
  const now = new Date("2026-12-01T00:00:00Z");
  it("keeps a listing that arrives in time", () => {
    expect(meetsDeadline(2, 6, new Date("2026-12-20"), now)).toBe(true);
  });
  it("drops a listing that arrives late", () => {
    expect(meetsDeadline(3, 20, new Date("2026-12-20"), now)).toBe(false);
  });
});

describe("refund limits", () => {
  const base = { capturedMinor: 7200, alreadyRefundedMinor: 0, sellerCapMinor: 1000 };
  it("auto-approves within the cap", () => {
    expect(checkRefund({ ...base, amountMinor: 1000 })).toBe("AUTO_APPROVED");
  });
  it("needs the seller above the cap", () => {
    expect(checkRefund({ ...base, amountMinor: 2000 })).toBe("NEEDS_SELLER_APPROVAL");
  });
  it("rejects more than was captured", () => {
    expect(checkRefund({ ...base, alreadyRefundedMinor: 7000, amountMinor: 500 })).toBe("REJECTED");
  });
});
