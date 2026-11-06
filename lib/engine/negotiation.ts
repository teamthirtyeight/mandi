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
 * Rule-based turn used when an agent's output is missing or invalid twice, so
 * the demo never stalls. The seller opens at list price and concedes 35% of the
 * gap to max(floor, buyer's bid); the buyer opens at 75% of list and concedes
 * 40% of the gap to min(ask, ceiling). Either side accepts once the gap is small
 * and within its limit. The result still goes through applyGuardrails.
 */
export function fallbackTurn(ctx: NegotiationContext, listPriceMinor: number): AgentTurn {
  const pound = 100;
  const ask = ctx.lastSellerOfferMinor;
  const bid = ctx.lastBuyerOfferMinor;
  const close = (a: number, b: number) => a - b <= Math.max(3 * pound, Math.round(a * 0.05));

  if (ctx.actor === "seller") {
    if (ask == null) return { message: "Thank you for your interest. It's made by hand and one of a kind.", offer_price: toMajor(listPriceMinor), action: "offer" };
    if (bid != null && bid >= ctx.floorMinor && close(ask, bid)) {
      return { message: "That works for me. It's yours.", offer_price: null, action: "accept" };
    }
    const target = Math.max(ctx.floorMinor, bid ?? ctx.floorMinor);
    const next = ask - Math.ceil(Math.max(0, ask - target) * 0.35);
    const rounded = Math.min(ask, Math.max(ctx.floorMinor, Math.round(next / pound) * pound));
    return { message: "I can come down a little for you.", offer_price: toMajor(rounded), action: "offer" };
  }

  // Buyer walks away once it is at its ceiling and the seller still won't come under it.
  if (ctx.round >= 4 && bid === ctx.ceilingMinor && ask != null && ask > ctx.ceilingMinor) {
    return { message: "Thank you, but that's above my budget. I'll pass.", offer_price: null, action: "walk_away" };
  }
  if (ask != null && ask <= ctx.ceilingMinor && (ctx.round >= 4 || (bid != null && close(ask, bid)))) {
    return { message: "Deal, thank you.", offer_price: null, action: "accept" };
  }
  const current = bid ?? Math.min(ctx.ceilingMinor, Math.round(listPriceMinor * 0.75));
  if (bid == null) return { message: "It's lovely. Would you consider this?", offer_price: toMajor(Math.round(current / pound) * pound), action: "offer" };
  const target = Math.min(ask ?? ctx.ceilingMinor, ctx.ceilingMinor);
  const next = current + Math.ceil(Math.max(0, target - current) * 0.4);
  const rounded = Math.max(current, Math.min(ctx.ceilingMinor, Math.round(next / pound) * pound));
  return { message: "Could you meet me here?", offer_price: toMajor(rounded), action: "offer" };
}

const INJECTION_PATTERNS = [
  /ignore (all |any |your |the )?(previous |prior |above )?(instructions|rules|prompt)/i,
  /disregard (all |your |the )?(previous |prior )?(instructions|rules)/i,
  /you are now/i,
  /system prompt/i,
  /(reveal|tell me|what is) (your|the) (floor|minimum|lowest)/i,
];

/** Labels counterparty text that tries to instruct the other agent. Detection only;
 *  the floor and ceiling hold whether or not this fires. */
export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
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
