/**
 * Negotiation rules. The LLMs never receive the seller's floor or the buyer's
 * ceiling. They receive only a limit for the current round, which the engine
 * derives here. This module has no I/O: state in, decision and state out.
 */
import { allow, deny, isPositiveMinor, retry, rewrite, type Decision, type Verdict } from "./core";

export type Actor = "seller" | "buyer";

export type NegotiationStatus =
  | "OPEN"
  | "OFFERED"
  | "COUNTERED"
  | "AGREED"
  | "AWAITING_BUYER_APPROVAL"
  | "ORDERED"
  | "WALKED_AWAY"
  | "EXPIRED"
  | "BLOCKED_BY_GUARDRAIL";

export interface NegotiationState {
  status: NegotiationStatus;
  /** 1-based. A round is one seller move followed by one buyer move. */
  round: number;
  maxRounds: number;
  nextActor: Actor;
  sellerLastMinor: number | null;
  buyerLastMinor: number | null;
  agreedMinor: number | null;
  currency: string;
  /** Secrets. Never pass these to an LLM; use agentBrief() instead. */
  limits: {
    floorMinor: number;
    ceilingMinor: number;
    listMinor: number;
  };
}

export type AgentTurn =
  | { action: "offer"; priceMinor: number }
  | { action: "accept" }
  | { action: "walk_away" };

export type ResolvedTurn =
  | { action: "offer"; finalMinor: number }
  | { action: "accept"; finalMinor: number }
  | { action: "walk_away"; finalMinor: null };

const BUYER_OPENING_MAX_BPS = 8000;
const CONCESSION_BPS = 4000;
const TERMINAL: readonly NegotiationStatus[] = [
  "AGREED",
  "AWAITING_BUYER_APPROVAL",
  "ORDERED",
  "WALKED_AWAY",
  "EXPIRED",
  "BLOCKED_BY_GUARDRAIL",
];

const concession = (gap: number): number => Math.ceil((gap * CONCESSION_BPS) / 10000);

export interface CreateNegotiationInput {
  floorMinor: number;
  ceilingMinor: number;
  listMinor: number;
  currency: string;
  maxRounds?: number;
}

export function createNegotiation(input: CreateNegotiationInput): NegotiationState {
  const { floorMinor, ceilingMinor, listMinor, currency, maxRounds = 6 } = input;
  if (![floorMinor, ceilingMinor, listMinor].every(isPositiveMinor)) {
    throw new Error("floor, ceiling and list price must be positive integer minor units");
  }
  if (floorMinor > listMinor) throw new Error("floor must not exceed list price");
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error("maxRounds must be at least 1");
  return {
    status: "OPEN",
    round: 1,
    maxRounds,
    nextActor: "seller",
    sellerLastMinor: null,
    buyerLastMinor: null,
    agreedMinor: null,
    currency,
    limits: { floorMinor, ceilingMinor, listMinor },
  };
}

/**
 * The furthest this actor may go in the current round. Each side concedes a
 * share of its remaining gap, so steps shrink.
 *
 * A model that's told a real limit tends to go straight to it and say so. So the
 * final round doesn't hand out the floor or ceiling. If a deal is possible, the
 * engine, which alone knows both limits, lets each side reach the midpoint of
 * the overlap. If no deal is possible, the normal steps continue and it expires.
 */
export function roundLimit(state: NegotiationState, actor: Actor): number {
  const { floorMinor, ceilingMinor, listMinor } = state.limits;
  const isFinalWithOverlap = state.round >= state.maxRounds && floorMinor <= ceilingMinor;
  const midpoint = Math.ceil((floorMinor + ceilingMinor) / 2);
  if (actor === "seller") {
    if (state.sellerLastMinor === null) return listMinor;
    if (isFinalWithOverlap) return Math.min(state.sellerLastMinor, midpoint);
    return Math.max(floorMinor, state.sellerLastMinor - concession(state.sellerLastMinor - floorMinor));
  }
  if (isFinalWithOverlap) {
    // An ask the buyer can afford may be taken, even if the seller didn't reach the midpoint.
    if (state.sellerLastMinor !== null && state.sellerLastMinor <= ceilingMinor) return state.sellerLastMinor;
    return Math.max(state.buyerLastMinor ?? 1, midpoint);
  }
  if (state.buyerLastMinor === null) {
    // At least 1, because a limit of 0 is an invalid offer and would stall the fallback.
    return Math.max(1, Math.floor((ceilingMinor * BUYER_OPENING_MAX_BPS) / 10000));
  }
  return Math.min(ceilingMinor, state.buyerLastMinor + concession(ceilingMinor - state.buyerLastMinor));
}

/** The only negotiation numbers an agent's prompt should receive. */
export function agentBrief(state: NegotiationState, actor: Actor) {
  return {
    role: actor,
    currency: state.currency,
    round: state.round,
    roundsRemaining: state.maxRounds - state.round,
    yourLastOfferMinor: actor === "seller" ? state.sellerLastMinor : state.buyerLastMinor,
    theirLastOfferMinor: actor === "seller" ? state.buyerLastMinor : state.sellerLastMinor,
    yourLimitThisRoundMinor: roundLimit(state, actor),
  };
}

export function evaluateTurn(
  state: NegotiationState,
  actor: Actor,
  turn: AgentTurn,
): Decision<ResolvedTurn> {
  if (TERMINAL.includes(state.status)) {
    return deny("TERMINAL_STATE", `negotiation is already ${state.status}`);
  }
  if (actor !== state.nextActor) return deny("OUT_OF_TURN", `it is the ${state.nextActor}'s turn`);

  if (turn.action === "walk_away") {
    return allow("WALK_AWAY", "agent walked away", { action: "walk_away", finalMinor: null });
  }

  const limit = roundLimit(state, actor);
  const counterAtLimit: ResolvedTurn = { action: "offer", finalMinor: limit };

  if (turn.action === "accept") {
    const theirLast = actor === "seller" ? state.buyerLastMinor : state.sellerLastMinor;
    if (theirLast === null) return retry("NOTHING_TO_ACCEPT", "there is no offer to accept");
    const withinLimit = actor === "seller" ? theirLast >= limit : theirLast <= limit;
    return withinLimit
      ? allow("ACCEPT", "accepted within the round limit", { action: "accept", finalMinor: theirLast })
      : rewrite("ACCEPT_OUTSIDE_LIMIT", "acceptance replaced with a counter-offer", counterAtLimit);
  }

  if (!isPositiveMinor(turn.priceMinor)) {
    return retry("INVALID_PRICE", "price must be a positive integer in minor units");
  }
  const price = turn.priceMinor;

  if (actor === "seller") {
    if (state.sellerLastMinor === null && price !== limit) {
      return rewrite("SELLER_OPENS_AT_LIST", "seller opening set to the list price", counterAtLimit);
    }
    if (state.sellerLastMinor !== null && price > state.sellerLastMinor) {
      return retry("NO_BACKTRACKING", "seller cannot raise its own last offer");
    }
    if (price < limit) {
      return rewrite("SELLER_ROUND_LIMIT", "offer replaced with a rule-based counter", counterAtLimit);
    }
  } else {
    if (state.buyerLastMinor !== null && price < state.buyerLastMinor) {
      return retry("NO_BACKTRACKING", "buyer cannot lower its own last offer");
    }
    if (price > limit) {
      return rewrite("BUYER_ROUND_LIMIT", "offer replaced with a rule-based counter", counterAtLimit);
    }
  }
  return allow("OFFER", "offer is within the round limit", { action: "offer", finalMinor: price });
}

/** Applies an approved or rewritten turn. Only call it with an evaluateTurn value. */
export function applyTurn(
  state: NegotiationState,
  actor: Actor,
  turn: ResolvedTurn,
): NegotiationState {
  if (turn.action === "walk_away") return { ...state, status: "WALKED_AWAY" };

  const next: NegotiationState = {
    ...state,
    sellerLastMinor: actor === "seller" ? turn.finalMinor : state.sellerLastMinor,
    buyerLastMinor: actor === "buyer" ? turn.finalMinor : state.buyerLastMinor,
  };

  const crossed =
    next.sellerLastMinor !== null &&
    next.buyerLastMinor !== null &&
    next.buyerLastMinor >= next.sellerLastMinor;
  if (crossed) {
    // The offer already on the table sets the price. A seller who undercuts the
    // buyer's standing bid still gets that bid, and a buyer who overbids pays the ask.
    return {
      ...next,
      status: "AGREED",
      agreedMinor: actor === "seller" ? next.buyerLastMinor : next.sellerLastMinor,
    };
  }

  if (actor === "seller") {
    return {
      ...next,
      nextActor: "buyer",
      status: state.buyerLastMinor === null ? "OFFERED" : "COUNTERED",
    };
  }
  if (state.round >= state.maxRounds) return { ...next, status: "EXPIRED" };
  return { ...next, nextActor: "seller", status: "COUNTERED", round: state.round + 1 };
}

export interface TurnEvent {
  actor: Actor;
  round: number;
  proposedMinor: number | null;
  finalMinor: number | null;
  guardrailResult: string;
  verdict: Verdict;
  status: NegotiationStatus;
}

/** Evaluates and applies one turn, returning a record for negotiation_turns. */
export function takeTurn(
  state: NegotiationState,
  actor: Actor,
  turn: AgentTurn,
): { decision: Decision<ResolvedTurn>; state: NegotiationState; event: TurnEvent } {
  const decision = evaluateTurn(state, actor, turn);
  const accepted = decision.verdict === "ALLOW" || decision.verdict === "REWRITE";
  const applied = accepted ? applyTurn(state, actor, decision.value) : state;
  return {
    decision,
    state: applied,
    event: {
      actor,
      round: state.round,
      proposedMinor: turn.action === "offer" ? turn.priceMinor : null,
      finalMinor: accepted ? decision.value.finalMinor : null,
      guardrailResult: decision.rule,
      verdict: decision.verdict,
      status: applied.status,
    },
  };
}

/** What the other side may see. Hides the proposed price and the rule that fired. */
export const counterpartyView = (event: TurnEvent) => ({
  actor: event.actor,
  round: event.round,
  priceMinor: event.finalMinor,
  status: event.status,
});

/**
 * Used after a failed retry or an LLM outage so the demo never stalls. Callers
 * must still pass the result through takeTurn().
 */
export function ruleBasedTurn(state: NegotiationState, actor: Actor): AgentTurn {
  const limit = roundLimit(state, actor);
  const theirLast = actor === "seller" ? state.buyerLastMinor : state.sellerLastMinor;
  if (theirLast !== null && (actor === "seller" ? theirLast >= limit : theirLast <= limit)) {
    return { action: "accept" };
  }
  return { action: "offer", priceMinor: limit };
}

const DAY_MS = 86_400_000;

/** Deadline rule: excludes a listing before negotiation starts. */
export const isDeliverable = (shipByMs: number, transitDays: number, deadlineMs: number): boolean =>
  shipByMs + transitDays * DAY_MS <= deadlineMs;

export interface DealCandidate {
  negotiationId: string;
  agreedMinor: number;
  referenceMinor: number | null;
  deliveryMs: number;
  deadlineMs: number;
  /** LLM rerank output. Untrusted, so it is clamped and carries limited weight. */
  matchQuality: number;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export function scoreDeal(deal: DealCandidate): number | null {
  if (deal.deliveryMs > deal.deadlineMs) return null;
  const price =
    deal.referenceMinor !== null && deal.referenceMinor > 0
      ? clamp01(1 - deal.agreedMinor / (2 * deal.referenceMinor))
      : 0.5;
  const delivery = clamp01((deal.deadlineMs - deal.deliveryMs) / (14 * DAY_MS));
  return 0.5 * price + 0.25 * delivery + 0.25 * clamp01(deal.matchQuality);
}

/** Best deal first. Deals that miss the deadline are removed. */
export function rankDeals(deals: readonly DealCandidate[]) {
  return deals
    .map((deal) => ({ deal, score: scoreDeal(deal) }))
    .filter((entry): entry is { deal: DealCandidate; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score);
}
