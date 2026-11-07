import { describe, expect, it } from "vitest";
import {
  assertSandboxBaseUrl,
  convertFloorUp,
  evaluateCapture,
  evaluateCreateOrder,
  evaluateRefund,
  freezeDeal,
  normalizeTracking,
  type CreateOrderCheck,
  type OrderRecord,
} from "../money";

const NOW = 1_000_000;

const deal = freezeDeal({
  negotiationId: "neg_1",
  mandateId: "man_1",
  listingId: "lst_1",
  sellerId: "meera",
  payeeEmail: "meera@example.test",
  amountMinor: 7200,
  currency: "GBP",
  shipToCountry: "GB",
  shipByMs: NOW + 1000,
  expiresAtMs: NOW + 1000,
});

const orderCheck = (overrides: Partial<CreateOrderCheck> = {}): CreateOrderCheck => ({
  deal,
  approvedHash: deal.hash,
  negotiationStatus: "AWAITING_BUYER_APPROVAL",
  negotiationAgreedMinor: 7200,
  mandate: { maxPriceMinor: 9000, currency: "GBP" },
  sellerPayeeEmail: "meera@example.test",
  stockAvailable: 1,
  existingOrderId: null,
  nowMs: NOW,
  ...overrides,
});

const order = (overrides: Partial<OrderRecord> = {}): OrderRecord => ({
  id: "ord_1",
  amountMinor: 7200,
  currency: "GBP",
  status: "AUTHORIZED",
  authorizationId: "auth_1",
  captureId: null,
  capturedMinor: 0,
  refundedTotalMinor: 0,
  refundCount: 0,
  autoRefundCount: 0,
  shipByMs: NOW + 1000,
  ...overrides,
});

const captured = (overrides: Partial<OrderRecord> = {}) =>
  order({ status: "CAPTURED", captureId: "cap_1", capturedMinor: 7200, ...overrides });

const policy = { refundCapMinor: 2000, maxAutoRefundsPerOrder: 1 };

describe("create order", () => {
  it("builds the order from the frozen deal", () => {
    const decision = evaluateCreateOrder(orderCheck());
    expect(decision.verdict).toBe("ALLOW");
    if (decision.verdict !== "ALLOW") return;
    expect(decision.value).toEqual({
      requestId: "order-neg_1",
      intent: "AUTHORIZE",
      amount: { currency_code: "GBP", value: "72.00" },
      payeeEmail: "meera@example.test",
      negotiationId: "neg_1",
    });
  });

  it("gives double clicks the same request ID", () => {
    const first = evaluateCreateOrder(orderCheck());
    const second = evaluateCreateOrder(orderCheck());
    expect(first).toEqual(second);
  });

  it.each([
    ["APPROVAL_MISMATCH", { approvedHash: "other" }],
    ["NOT_AWAITING_APPROVAL", { negotiationStatus: "AGREED" }],
    ["DUPLICATE_ORDER", { existingOrderId: "ord_0" }],
    ["DEAL_EXPIRED", { nowMs: NOW + 1001 }],
    ["AMOUNT_MISMATCH", { negotiationAgreedMinor: 100 }],
    ["CURRENCY_MISMATCH", { mandate: { maxPriceMinor: 9000, currency: "USD" } }],
    ["OVER_MANDATE", { mandate: { maxPriceMinor: 7199, currency: "GBP" } }],
    ["PAYEE_MISMATCH", { sellerPayeeEmail: "attacker@example.test" }],
    ["OUT_OF_STOCK", { stockAvailable: 0 }],
  ] as const)("denies with %s", (rule, overrides) => {
    const decision = evaluateCreateOrder(orderCheck(overrides as Partial<CreateOrderCheck>));
    expect(decision.verdict).toBe("DENY");
    expect(decision.rule).toBe(rule);
  });

  it("detects stored terms changed after freezing", () => {
    const tampered = { ...deal, amountMinor: 1 };
    expect(evaluateCreateOrder(orderCheck({ deal: tampered, negotiationAgreedMinor: 1 })).rule).toBe("DEAL_TAMPERED");
  });
});

describe("tracking format", () => {
  it.each([
    ["ROYAL_MAIL", "ab 123456789 gb", "AB123456789GB"],
    ["INDIA_POST", "EE123456789IN", "EE123456789IN"],
    ["DHL", "1234567890", "1234567890"],
    ["UPS", "1z999aa10123456784", "1Z999AA10123456784"],
  ])("accepts %s", (carrier, input, expected) => {
    expect(normalizeTracking(carrier, input)).toBe(expected);
  });

  it.each([
    ["DHL", "1111111111"],
    ["DHL", "123"],
    ["FEDEX", "AAA"],
    ["PIGEON", "1234567890"],
  ])("rejects %s %s", (carrier, input) => {
    expect(normalizeTracking(carrier, input)).toBeNull();
  });
});

describe("capture", () => {
  const tracking = { carrier: "DHL", number: "1234567890", enteredBy: "seller" as const };
  const check = (overrides = {}) => ({
    order: order(),
    tracking,
    trackingUsedByOtherOrder: false,
    nowMs: NOW,
    ...overrides,
  });

  it("captures the full authorized amount after seller-entered tracking", () => {
    const decision = evaluateCapture(check());
    expect(decision.verdict).toBe("ALLOW");
    if (decision.verdict !== "ALLOW") return;
    expect(decision.value.amount.value).toBe("72.00");
    expect(decision.value.requestId).toBe("capture-auth_1");
  });

  it("allows a retry after a failed capture on a shipped order", () => {
    expect(evaluateCapture(check({ order: order({ status: "SHIPPED" }) })).verdict).toBe("ALLOW");
  });

  it("won't capture on tracking that only an agent supplied", () => {
    const decision = evaluateCapture(check({ tracking: { ...tracking, enteredBy: "agent" } }));
    expect(decision.verdict).toBe("ESCALATE");
    expect(decision.rule).toBe("TRACKING_NEEDS_SELLER");
  });

  it.each([
    ["NOT_CAPTURABLE", { order: order({ status: "CAPTURED" }) }],
    ["NOT_CAPTURABLE", { order: order({ status: "VOIDED" }) }],
    ["NO_AUTHORIZATION", { order: order({ authorizationId: null }) }],
    ["TRACKING_INVALID", { tracking: { ...tracking, number: "FAKE" } }],
    ["TRACKING_REUSED", { trackingUsedByOtherOrder: true }],
  ])("denies with %s", (rule, overrides) => {
    const decision = evaluateCapture(check(overrides));
    expect(decision.verdict).toBe("DENY");
    expect(decision.rule).toBe(rule);
  });

  it("escalates once the ship-by date has passed", () => {
    expect(evaluateCapture(check({ nowMs: NOW + 1001 })).rule).toBe("SHIP_WINDOW_PASSED");
  });
});

describe("refund", () => {
  const agentRefund = (amountMinor: number) => ({ amountMinor, currency: "GBP", approvedBy: "agent" as const });
  const sellerRefund = (amountMinor: number) => ({ amountMinor, currency: "GBP", approvedBy: "seller" as const });

  it("lets an agent refund within the cap and reports the partial status", () => {
    const decision = evaluateRefund(captured(), agentRefund(1000), policy);
    expect(decision.verdict).toBe("ALLOW");
    if (decision.verdict !== "ALLOW") return;
    expect(decision.value.next).toEqual({
      status: "PARTIALLY_REFUNDED",
      refundedTotalMinor: 1000,
      refundCount: 1,
      autoRefundCount: 1,
    });
  });

  it("escalates an agent refund above the cap", () => {
    expect(evaluateRefund(captured(), agentRefund(2001), policy).verdict).toBe("ESCALATE");
  });

  it("counts earlier refunds toward the cap", () => {
    const earlier = captured({ status: "PARTIALLY_REFUNDED", refundedTotalMinor: 1500, refundCount: 1 });
    expect(evaluateRefund(earlier, agentRefund(600), policy).rule).toBe("OVER_REFUND_CAP");
  });

  it("limits automatic refunds per order", () => {
    const earlier = captured({ status: "PARTIALLY_REFUNDED", refundedTotalMinor: 100, refundCount: 1, autoRefundCount: 1 });
    expect(evaluateRefund(earlier, agentRefund(100), policy).rule).toBe("AUTO_REFUND_LIMIT");
  });

  it("always escalates when no cap is set", () => {
    expect(evaluateRefund(captured(), agentRefund(1), { ...policy, refundCapMinor: null }).rule).toBe("NO_REFUND_CAP");
  });

  it("lets the seller approve above the cap and marks a full refund", () => {
    const decision = evaluateRefund(captured(), sellerRefund(7200), policy);
    expect(decision.verdict).toBe("ALLOW");
    if (decision.verdict === "ALLOW") expect(decision.value.next.status).toBe("REFUNDED");
  });

  it("never lets total refunds exceed the captured amount, even for the seller", () => {
    const earlier = captured({ status: "PARTIALLY_REFUNDED", refundedTotalMinor: 7000, refundCount: 1 });
    expect(evaluateRefund(earlier, sellerRefund(201), policy).rule).toBe("OVER_CAPTURED");
  });

  it("uses a new request ID for each refund but reuses it on a retry", () => {
    const id = (o: OrderRecord) => {
      const d = evaluateRefund(o, agentRefund(100), policy);
      return d.verdict === "ALLOW" ? d.value.requestId : null;
    };
    expect(id(captured())).toBe(id(captured()));
    expect(id(captured())).not.toBe(id(captured({ refundCount: 1 })));
  });

  it.each([
    ["NOT_REFUNDABLE", order({ status: "AUTHORIZED" })],
    ["NOT_REFUNDABLE", captured({ status: "REFUNDED" })],
    ["NO_CAPTURE", captured({ captureId: null })],
  ])("denies with %s", (rule, target) => {
    expect(evaluateRefund(target, agentRefund(100), policy).rule).toBe(rule);
  });

  it.each([0, -100, 10.5, NaN])("denies invalid amount %s", (amount) => {
    expect(evaluateRefund(captured(), agentRefund(amount), policy).rule).toBe("INVALID_AMOUNT");
  });

  it("denies a currency mismatch", () => {
    expect(evaluateRefund(captured(), { ...agentRefund(100), currency: "INR" }, policy).rule).toBe("CURRENCY_MISMATCH");
  });
});

describe("helpers", () => {
  it("rounds a converted floor up in the seller's favour", () => {
    expect(convertFloorUp(500000, 1, 110)).toBe(4546);
    expect(convertFloorUp(11000, 1, 110)).toBe(100);
  });

  it("only accepts PayPal sandbox hosts", () => {
    expect(() => assertSandboxBaseUrl("https://api-m.sandbox.paypal.com")).not.toThrow();
    expect(() => assertSandboxBaseUrl("https://api-m.paypal.com")).toThrow();
    expect(() => assertSandboxBaseUrl("https://api-m.sandbox.paypal.com.evil.test")).toThrow();
    expect(() => assertSandboxBaseUrl("http://api-m.sandbox.paypal.com")).toThrow();
  });
});
