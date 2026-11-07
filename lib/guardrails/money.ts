/**
 * Rules for every money-moving PayPal call. Agents can only propose. These
 * functions decide, and the payment service acts only on an ALLOW.
 *
 * They read state but cannot lock it. Run each check and its state update in
 * one database transaction, for example with a conditional UPDATE.
 */
import { createHash } from "node:crypto";
import { allow, deny, escalate, isPositiveMinor, toDecimalString, type Decision } from "./core";

export type OrderStatus =
  | "CREATED"
  | "APPROVED"
  | "AUTHORIZED"
  | "SHIPPED"
  | "CAPTURED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "VOIDED";

export interface PayPalAmount {
  currency_code: string;
  value: string;
}

const toAmount = (minor: number, currency: string): PayPalAmount => ({
  currency_code: currency,
  value: toDecimalString(minor, currency),
});

/* ---------------------------------- Deal ---------------------------------- */

export interface DealTerms {
  negotiationId: string;
  mandateId: string;
  listingId: string;
  sellerId: string;
  payeeEmail: string;
  amountMinor: number;
  currency: string;
  shipToCountry: string;
  shipByMs: number;
  expiresAtMs: number;
}

export interface FrozenDeal extends DealTerms {
  hash: string;
}

const hashTerms = (terms: DealTerms): string => {
  const canonical = [
    terms.negotiationId,
    terms.mandateId,
    terms.listingId,
    terms.sellerId,
    terms.payeeEmail,
    terms.amountMinor,
    terms.currency,
    terms.shipToCountry,
    terms.shipByMs,
    terms.expiresAtMs,
  ];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};

/** Freezes the terms shown on the deal card. The buyer approves this exact hash. */
export function freezeDeal(terms: DealTerms): FrozenDeal {
  if (!isPositiveMinor(terms.amountMinor)) throw new Error("deal amount must be positive minor units");
  return { ...terms, hash: hashTerms(terms) };
}

export interface CreateOrderCheck {
  /** Loaded from the database, never from the request body. */
  deal: FrozenDeal;
  /** The hash the buyer's browser sends back with the Approve tap. */
  approvedHash: string;
  negotiationStatus: string;
  negotiationAgreedMinor: number | null;
  mandate: { maxPriceMinor: number; currency: string };
  sellerPayeeEmail: string;
  stockAvailable: number;
  existingOrderId: string | null;
  nowMs: number;
}

export interface CreateOrderParams {
  requestId: string;
  intent: "AUTHORIZE";
  amount: PayPalAmount;
  payeeEmail: string;
  negotiationId: string;
}

export function evaluateCreateOrder(check: CreateOrderCheck): Decision<CreateOrderParams> {
  const { deal } = check;
  const { hash: _hash, ...terms } = deal;
  if (hashTerms(terms) !== deal.hash) return deny("DEAL_TAMPERED", "stored terms do not match their hash");
  if (check.approvedHash !== deal.hash) {
    return deny("APPROVAL_MISMATCH", "the buyer approved different terms");
  }
  if (check.negotiationStatus !== "AWAITING_BUYER_APPROVAL") {
    return deny("NOT_AWAITING_APPROVAL", `negotiation is ${check.negotiationStatus}`);
  }
  if (check.existingOrderId !== null) {
    return deny("DUPLICATE_ORDER", `order ${check.existingOrderId} already exists for this deal`);
  }
  if (check.nowMs > deal.expiresAtMs) return deny("DEAL_EXPIRED", "the frozen deal has expired");
  if (check.negotiationAgreedMinor !== deal.amountMinor) {
    return deny("AMOUNT_MISMATCH", "deal amount differs from the negotiated price");
  }
  if (check.mandate.currency !== deal.currency) {
    return deny("CURRENCY_MISMATCH", "deal currency differs from the mandate");
  }
  if (deal.amountMinor > check.mandate.maxPriceMinor) {
    return deny("OVER_MANDATE", "deal amount exceeds the buyer's mandate");
  }
  if (check.sellerPayeeEmail !== deal.payeeEmail) {
    return deny("PAYEE_MISMATCH", "payee is not the listing seller's PayPal account");
  }
  if (check.stockAvailable < 1) return deny("OUT_OF_STOCK", "the listing has no stock left");
  return allow("CREATE_ORDER", "order matches the approved deal", orderParams(deal));
}

/** Derived from the deal, so double clicks and retries reuse the same request ID. */
export const orderParams = (deal: FrozenDeal): CreateOrderParams => ({
  requestId: `order-${deal.negotiationId}`,
  intent: "AUTHORIZE",
  amount: toAmount(deal.amountMinor, deal.currency),
  payeeEmail: deal.payeeEmail,
  negotiationId: deal.negotiationId,
});

/* -------------------------------- Tracking -------------------------------- */

const UPU_S10 = /^[A-Z]{2}\d{9}[A-Z]{2}$/;
const CARRIER_FORMATS: Record<string, RegExp> = {
  ROYAL_MAIL: UPU_S10,
  INDIA_POST: UPU_S10,
  DHL: /^\d{10}$/,
  FEDEX: /^(\d{12}|\d{15}|\d{20})$/,
  UPS: /^1Z[0-9A-Z]{16}$/,
};

export const SUPPORTED_CARRIERS = Object.keys(CARRIER_FORMATS);

/** Checks format only. Real carrier lookups are out of scope for the hackathon. */
export function normalizeTracking(carrier: string, number: string): string | null {
  const format = CARRIER_FORMATS[carrier];
  if (!format) return null;
  const normalized = number.replace(/[\s-]/g, "").toUpperCase();
  if (!format.test(normalized)) return null;
  const digits = normalized.replace(/\D/g, "");
  // Rejects placeholder numbers such as 1111111111.
  if (digits.length > 0 && new Set(digits).size === 1) return null;
  return normalized;
}

/* --------------------------------- Capture -------------------------------- */

export interface OrderRecord {
  id: string;
  amountMinor: number;
  currency: string;
  status: OrderStatus;
  authorizationId: string | null;
  captureId: string | null;
  capturedMinor: number;
  refundedTotalMinor: number;
  refundCount: number;
  autoRefundCount: number;
  shipByMs: number;
}

export interface CaptureCheck {
  order: OrderRecord;
  tracking: { carrier: string; number: string; enteredBy: "seller" | "agent" };
  /** True if another order already uses this normalized tracking number. */
  trackingUsedByOtherOrder: boolean;
  nowMs: number;
}

export interface CaptureParams {
  authorizationId: string;
  requestId: string;
  amount: PayPalAmount;
  carrier: string;
  trackingNumber: string;
}

export function evaluateCapture(check: CaptureCheck): Decision<CaptureParams> {
  const { order, tracking } = check;
  if (order.status !== "AUTHORIZED" && order.status !== "SHIPPED") {
    return deny("NOT_CAPTURABLE", `order is ${order.status}`);
  }
  if (!order.authorizationId) return deny("NO_AUTHORIZATION", "order has no authorization ID");
  if (tracking.enteredBy !== "seller") {
    return escalate("TRACKING_NEEDS_SELLER", "the seller must enter or confirm the tracking number");
  }
  const number = normalizeTracking(tracking.carrier, tracking.number);
  if (number === null) return deny("TRACKING_INVALID", "tracking number does not fit the carrier's format");
  if (check.trackingUsedByOtherOrder) return deny("TRACKING_REUSED", "tracking number is used by another order");
  if (check.nowMs > order.shipByMs) {
    return escalate("SHIP_WINDOW_PASSED", "ship-by date has passed, so a person must review this capture");
  }
  return allow("CAPTURE", "shipment details passed all checks", {
    authorizationId: order.authorizationId,
    requestId: `capture-${order.authorizationId}`,
    amount: toAmount(order.amountMinor, order.currency),
    carrier: tracking.carrier,
    trackingNumber: number,
  });
}

/* --------------------------------- Refund --------------------------------- */

export interface RefundProposal {
  amountMinor: number;
  currency: string;
  /** "seller" means the seller tapped approve for this exact amount. */
  approvedBy: "agent" | "seller";
}

export interface RefundPolicy {
  /** Total an agent may refund on one order without asking. Null means always ask. */
  refundCapMinor: number | null;
  maxAutoRefundsPerOrder: number;
}

export interface RefundParams {
  captureId: string;
  requestId: string;
  amount: PayPalAmount;
  /** Save these with the refund, in the same transaction. */
  next: {
    status: "PARTIALLY_REFUNDED" | "REFUNDED";
    refundedTotalMinor: number;
    refundCount: number;
    autoRefundCount: number;
  };
}

/** Takes numbers only. Complaint text must never reach this function. */
export function evaluateRefund(
  order: OrderRecord,
  proposal: RefundProposal,
  policy: RefundPolicy,
): Decision<RefundParams> {
  if (order.status !== "CAPTURED" && order.status !== "PARTIALLY_REFUNDED") {
    return deny("NOT_REFUNDABLE", `order is ${order.status}`);
  }
  if (!order.captureId) return deny("NO_CAPTURE", "order has no capture ID");
  if (!isPositiveMinor(proposal.amountMinor)) return deny("INVALID_AMOUNT", "refund must be positive minor units");
  if (proposal.currency !== order.currency) return deny("CURRENCY_MISMATCH", "refund currency differs from the order");

  const nextTotal = order.refundedTotalMinor + proposal.amountMinor;
  if (nextTotal > order.capturedMinor) {
    return deny("OVER_CAPTURED", "total refunds would exceed the captured amount");
  }

  const isAgent = proposal.approvedBy === "agent";
  if (isAgent) {
    if (policy.refundCapMinor === null) return escalate("NO_REFUND_CAP", "the seller has not set a refund cap");
    if (nextTotal > policy.refundCapMinor) {
      return escalate("OVER_REFUND_CAP", "total refunds would exceed the seller's cap");
    }
    if (order.autoRefundCount >= policy.maxAutoRefundsPerOrder) {
      return escalate("AUTO_REFUND_LIMIT", "this order has used its automatic refunds");
    }
  }

  const refundCount = order.refundCount + 1;
  return allow("REFUND", isAgent ? "within the seller's cap" : "approved by the seller", {
    captureId: order.captureId,
    // A failed attempt leaves refundCount unchanged, so a retry reuses this ID.
    requestId: `refund-${order.captureId}-${refundCount}`,
    amount: toAmount(proposal.amountMinor, proposal.currency),
    next: {
      status: nextTotal === order.capturedMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
      refundedTotalMinor: nextTotal,
      refundCount,
      autoRefundCount: order.autoRefundCount + (isAgent ? 1 : 0),
    },
  });
}

/* --------------------------------- Helpers -------------------------------- */

/**
 * Converts a floor into the deal currency, rounding up in the seller's favour.
 * Snapshot the rate when the negotiation opens. Rate = numerator / denominator.
 */
export function convertFloorUp(floorMinor: number, rateNumerator: number, rateDenominator: number): number {
  if (!isPositiveMinor(floorMinor) || !isPositiveMinor(rateNumerator) || !isPositiveMinor(rateDenominator)) {
    throw new Error("floor and rate must be positive integers");
  }
  const scaled = BigInt(floorMinor) * BigInt(rateNumerator);
  const denominator = BigInt(rateDenominator);
  return Number((scaled + denominator - BigInt(1)) / denominator);
}

const SANDBOX_HOSTS = new Set(["api-m.sandbox.paypal.com", "api.sandbox.paypal.com"]);

/** Call at startup so the app refuses to run against live PayPal. */
export function assertSandboxBaseUrl(baseUrl: string): void {
  const { protocol, hostname } = new URL(baseUrl);
  if (protocol !== "https:" || !SANDBOX_HOSTS.has(hostname)) {
    throw new Error(`Refusing to start: ${hostname} is not a PayPal sandbox host`);
  }
}
