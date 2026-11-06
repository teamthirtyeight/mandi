// Deterministic negotiation engine. Every agent turn passes through
// applyGuardrails before it is saved or shown. The LLM proposes; this code
// decides. Nothing here calls an LLM or PayPal.
import { z } from "zod";

export const MAX_ROUNDS = 6;

// What an agent returns each turn. offer_price is in major units (pounds)
// because that is what the model reads and writes; the engine works in minor units.
export const AgentTurnSchema = z.object({
  message: z.string().min(1).max(600),
  offer_price: z.number().positive().nullable(),
  action: z.enum(["offer", "accept", "walk_away"]),
});
export type AgentTurn = z.infer<typeof AgentTurnSchema>;

export type Actor = "buyer" | "seller";

export type NegotiationState =
  | "OPEN"
  | "OFFERED"
  | "COUNTERED"
  | "AGREED"
  | "AWAITING_BUYER_APPROVAL"
  | "ORDERED"
  | "WALKED_AWAY"
  | "EXPIRED"
  | "BLOCKED_BY_GUARDRAIL";

export type GuardrailResult =
  | "PASSED"
  | "CLAMPED_TO_FLOOR"
  | "CLAMPED_TO_CEILING"
  | "REJECTED_BACKTRACK"
  | "REJECTED_INVALID"
  | "REJECTED_TERMINAL"
  | "AGREED"
  | "WALKED_AWAY"
  | "EXPIRED";

export const TERMINAL_STATES: ReadonlySet<NegotiationState> = new Set([
  "AGREED",
  "AWAITING_BUYER_APPROVAL",
  "ORDERED",
  "WALKED_AWAY",
  "EXPIRED",
  "BLOCKED_BY_GUARDRAIL",
]);

export interface NegotiationContext {
  actor: Actor;
  state: NegotiationState;
  /** Seller's private floor, minor units. Never shown to the buyer side. */
  floorMinor: number;
  /** Buyer's mandate max price, minor units. Never shown to the seller side. */
  ceilingMinor: number;
  lastSellerOfferMinor: number | null;
  lastBuyerOfferMinor: number | null;
  /** Current round, 1-based. A round is one seller turn plus one buyer turn. */
  round: number;
  maxRounds?: number;
}

export interface GuardrailOutcome {
  /** Price the agent asked for, minor units (null when it made no offer). */
  proposedMinor: number | null;
  /** Price the engine allowed, minor units. */
  finalMinor: number | null;
  guardrailResult: GuardrailResult;
  state: NegotiationState;
  /** Set when state becomes AGREED. Always the seller's last offer. */
  agreedMinor: number | null;
  lastSellerOfferMinor: number | null;
  lastBuyerOfferMinor: number | null;
  /** True when the turn was refused and the agent may retry once. */
  retryable: boolean;
}

export const toMinor = (major: number) => Math.round(major * 100);
export const toMajor = (minor: number) => minor / 100;

export function applyGuardrails(turn: AgentTurn, ctx: NegotiationContext): GuardrailOutcome {
  const maxRounds = ctx.maxRounds ?? MAX_ROUNDS;
  const proposedMinor = turn.offer_price == null ? null : toMinor(turn.offer_price);
  const base = {
    proposedMinor,
    lastSellerOfferMinor: ctx.lastSellerOfferMinor,
    lastBuyerOfferMinor: ctx.lastBuyerOfferMinor,
    agreedMinor: null,
  };
  const refuse = (guardrailResult: GuardrailResult, retryable: boolean): GuardrailOutcome => ({
    ...base,
    finalMinor: null,
    guardrailResult,
    state: ctx.state,
    retryable,
  });

  if (TERMINAL_STATES.has(ctx.state)) return refuse("REJECTED_TERMINAL", false);

  if (ctx.round > maxRounds) {
    return { ...base, finalMinor: null, guardrailResult: "EXPIRED", state: "EXPIRED", retryable: false };
  }

  if (turn.action === "walk_away") {
    return { ...base, finalMinor: null, guardrailResult: "WALKED_AWAY", state: "WALKED_AWAY", retryable: false };
  }

  if (turn.action === "accept") return applyAccept(ctx, base);

  // action === "offer"
  if (proposedMinor == null || !Number.isFinite(proposedMinor) || proposedMinor <= 0) {
    return refuse("REJECTED_INVALID", true);
  }

  let finalMinor = proposedMinor;
  let guardrailResult: GuardrailResult = "PASSED";

  if (ctx.actor === "seller" && finalMinor < ctx.floorMinor) {
    finalMinor = ctx.floorMinor;
    guardrailResult = "CLAMPED_TO_FLOOR";
  }
  if (ctx.actor === "buyer" && finalMinor > ctx.ceilingMinor) {
    finalMinor = ctx.ceilingMinor;
    guardrailResult = "CLAMPED_TO_CEILING";
  }

  // No backtracking: the seller never raises, the buyer never lowers.
  const own = ctx.actor === "seller" ? ctx.lastSellerOfferMinor : ctx.lastBuyerOfferMinor;
  if (own != null) {
    const backtracks = ctx.actor === "seller" ? finalMinor > own : finalMinor < own;
    if (backtracks) return refuse("REJECTED_BACKTRACK", true);
  }

  const lastSellerOfferMinor = ctx.actor === "seller" ? finalMinor : ctx.lastSellerOfferMinor;
  const lastBuyerOfferMinor = ctx.actor === "buyer" ? finalMinor : ctx.lastBuyerOfferMinor;

  // Agreement: buyer's bid meets the seller's ask. Price is the seller's last offer.
  if (
    lastSellerOfferMinor != null &&
    lastBuyerOfferMinor != null &&
    lastBuyerOfferMinor >= lastSellerOfferMinor
  ) {
    return {
      proposedMinor,
      finalMinor,
      guardrailResult: guardrailResult === "PASSED" ? "AGREED" : guardrailResult,
      state: "AGREED",
      agreedMinor: lastSellerOfferMinor,
      lastSellerOfferMinor,
      lastBuyerOfferMinor,
      retryable: false,
    };
  }

  return {
    proposedMinor,
    finalMinor,
    guardrailResult,
    state: ctx.state === "OPEN" ? "OFFERED" : "COUNTERED",
    agreedMinor: null,
    lastSellerOfferMinor,
    lastBuyerOfferMinor,
    retryable: false,
  };
}

function applyAccept(
  ctx: NegotiationContext,
  base: Pick<GuardrailOutcome, "proposedMinor" | "lastSellerOfferMinor" | "lastBuyerOfferMinor">,
): GuardrailOutcome {
  const refuse = (): GuardrailOutcome => ({
    ...base,
    agreedMinor: null,
    finalMinor: null,
    guardrailResult: "REJECTED_INVALID",
    state: ctx.state,
    retryable: true,
  });

  if (ctx.actor === "buyer") {
    // Buyer accepts the seller's ask; it must be within the mandate.
    const ask = ctx.lastSellerOfferMinor;
    if (ask == null || ask > ctx.ceilingMinor) return refuse();
    return {
      ...base,
      lastBuyerOfferMinor: ask,
      finalMinor: ask,
      agreedMinor: ask,
      guardrailResult: "AGREED",
      state: "AGREED",
      retryable: false,
    };
  }

  // Seller accepts the buyer's bid; it must clear the floor.
  const bid = ctx.lastBuyerOfferMinor;
  if (bid == null || bid < ctx.floorMinor) return refuse();
  return {
    ...base,
    lastSellerOfferMinor: bid,
    finalMinor: bid,
    agreedMinor: bid,
    guardrailResult: "AGREED",
    state: "AGREED",
    retryable: false,
  };
}

/**
 * Rule-based counter-offer used when an agent's output fails validation twice,
 * so the demo never stalls. Concedes a third of the remaining gap per turn,
 * then rounds to whole pounds. The result still goes through applyGuardrails.
 */
export function fallbackTurn(ctx: NegotiationContext, listPriceMinor: number): AgentTurn {
  const pound = 100;
  if (ctx.actor === "seller") {
    const current = ctx.lastSellerOfferMinor ?? listPriceMinor;
    const target = ctx.lastBuyerOfferMinor ?? ctx.floorMinor;
    const next = Math.max(ctx.floorMinor, current - Math.ceil(Math.max(0, current - target) / 3));
    const rounded = Math.max(ctx.floorMinor, Math.round(next / pound) * pound);
    return { message: "I can come down a little for you.", offer_price: toMajor(rounded), action: "offer" };
  }
  const current = ctx.lastBuyerOfferMinor ?? Math.round(listPriceMinor * 0.75);
  const target = ctx.lastSellerOfferMinor ?? ctx.ceilingMinor;
  const next = Math.min(ctx.ceilingMinor, current + Math.ceil(Math.max(0, target - current) / 3));
  const rounded = Math.min(ctx.ceilingMinor, Math.round(next / pound) * pound);
  return { message: "Could you meet me here?", offer_price: toMajor(rounded), action: "offer" };
}

/** Deadline filter: drop listings that cannot arrive by the mandate deadline. */
export function meetsDeadline(
  shipByDays: number,
  transitDays: number,
  deadline: Date,
  now: Date = new Date(),
): boolean {
  const arrival = new Date(now.getTime() + (shipByDays + transitDays) * 24 * 60 * 60 * 1000);
  return arrival.getTime() <= deadline.getTime();
}

export type RefundDecision = "AUTO_APPROVED" | "NEEDS_SELLER_APPROVAL" | "REJECTED";

/** Refund limit: agent-proposed refunds above the seller's cap need the seller's tap. */
export function checkRefund(opts: {
  amountMinor: number;
  capturedMinor: number;
  alreadyRefundedMinor: number;
  sellerCapMinor: number;
}): RefundDecision {
  const { amountMinor, capturedMinor, alreadyRefundedMinor, sellerCapMinor } = opts;
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return "REJECTED";
  if (amountMinor + alreadyRefundedMinor > capturedMinor) return "REJECTED";
  if (amountMinor > sellerCapMinor) return "NEEDS_SELLER_APPROVAL";
  return "AUTO_APPROVED";
}
