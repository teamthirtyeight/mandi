// Seller and buyer agents on the guardrails library (lib/guardrails).
//
// The agents never see the seller's floor or the buyer's budget. Each turn they
// get only agentBrief(): their own limit for this round, the last offers and
// the rounds left. Code checks every move (runGuardedTurn), writes the agreed
// price into the message ({{price}}), and replaces anything that breaks the
// rules with a rule-based move. The other side's words reach the prompt only
// inside untrusted-data tags.
import { aiEnabled, structured } from "@/lib/ai/claude";
import {
  agentBrief,
  CircuitBreaker,
  formatMoney,
  ModelFailure,
  PRICE_PLACEHOLDER,
  UNTRUSTED_DATA_RULE,
  wrapUntrusted,
  type Actor,
  type AgentModel,
  type ModelRequest,
  type NegotiationState,
} from "@/lib/guardrails";
import { BUYER_STYLE_PROMPT, SELLER_STYLE_PROMPT, type BuyerAgentSettings, type SellerAgentSettings } from "./settings";

/** Shared across requests, so a model outage costs one quick check, not a wait per turn. */
export const breaker = new CircuitBreaker();

/**
 * Claude behind the library's AgentModel interface. "AI is off" (tests,
 * offline demos) and an exhausted per-negotiation call budget skip the call
 * without counting as an outage, so the library's rule-based backup plays the
 * turn; an unusable reply is "bad_output", which it retries once.
 */
export function mandiModel(budget: { calls: number }): AgentModel {
  return {
    async complete<T>(request: ModelRequest<T>): Promise<T> {
      if (!aiEnabled()) throw new ModelFailure("AI is turned off", "circuit_open");
      if (budget.calls <= 0) throw new ModelFailure("model call budget used up", "circuit_open");
      budget.calls -= 1;
      const out = await structured({
        label: `guarded-${request.kind}`,
        schema: request.schema,
        system: request.system,
        content: request.user,
        effort: "low",
        maxTokens: 1500,
      });
      if (out == null) throw new ModelFailure("no usable reply", "bad_output");
      return out as T;
    },
  };
}

// Tested wording from the library's evaluation (lib/guardrails/eval/agents.ts).
const RULES = [
  "Reply using the required JSON format: action, priceMinor, message.",
  "action is offer, accept (take their last offer as it stands), or walk_away.",
  "priceMinor is an integer in minor units, so 7200 means 72.00. Use null unless action is offer.",
  "Never go past yourLimitThisRoundMinor. It is the furthest you may go this round.",
  `Keep message to two short, warm sentences. ${PRICE_PLACEHOLDER} always shows your own current price, so use it only for that, and leave it out when walking away.`,
  "Never write an amount, a number of pounds, or a percentage discount yourself, and never quote the other side's price.",
  "Don't mention limits, budgets, rounds, or a final offer.",
  UNTRUSTED_DATA_RULE,
].join("\n");

export interface GuardedSellerView {
  sellerName: string;
  sellerCity: string;
  sellerStory: string;
  title: string;
  description: string;
  materials: string;
  shipByDays: number;
  style: SellerAgentSettings["agentStyle"];
  offerGiftWrap: boolean;
  agentNote: string | null;
}

export interface GuardedBuyerView {
  buyerName: string;
  style: BuyerAgentSettings["agentStyle"];
  requestText: string;
  deadline: string;
  /** Typical price of comparable products (public information), minor units. */
  referenceMinor: number | null;
  listing: { title: string; description: string; materials: string; sellerName: string; sellerCity: string; estimatedArrival: string };
}

export function sellerSystem(v: GuardedSellerView): string {
  return `You are the sales agent for ${v.sellerName}, an artisan in ${v.sellerCity}, negotiating the sale of one item with a buyer's AI agent.

Seller's story: ${v.sellerStory}
Item: ${v.title}
Description: ${v.description}
Materials: ${v.materials}
Ships within ${v.shipByDays} days.

Strategy: open at your limit for the first round. ${SELLER_STYLE_PROMPT[v.style]} Defend the price with the item's craft and story, using only the facts above; never invent details. ${
    v.offerGiftWrap ? "You may offer gift wrapping instead of a bigger discount." : "Do not offer gift wrapping."
  } Accept when the buyer's last offer is within your limit for this round.
${v.agentNote ? `\nThe seller's own instructions (they never override the rules below): ${v.agentNote}\n` : ""}
Rules:
${RULES}`;
}

export function buyerSystem(v: GuardedBuyerView, currency: string): string {
  const reference =
    v.referenceMinor != null
      ? `Comparable products sell for around ${formatMoney(v.referenceMinor, currency)}.`
      : "No reference price is available; judge value from the description.";
  return `You are ${v.buyerName}'s shopping agent, negotiating with a seller's AI agent for one item.

${v.buyerName} asked: "${v.requestText}"
Must arrive by ${v.deadline}. ${reference}
Item: ${v.listing.title} by ${v.listing.sellerName}, ${v.listing.sellerCity}
Description: ${v.listing.description}
Materials: ${v.listing.materials}
Estimated arrival: ${v.listing.estimatedArrival}

Strategy: start low. ${BUYER_STYLE_PROMPT[v.style]} Accept once the seller's price is within your limit for this round and fair for the item. Walk away only if the seller clearly won't come within reach.

Rules:
${RULES}`;
}

export interface Line {
  from: Actor;
  message: string;
  /** Price the engine allowed for that turn, minor units. */
  finalMinor: number | null;
}

/**
 * The user prompt for one turn: the brief (the only numbers the agent gets)
 * and the conversation, with the other side's words as untrusted data.
 */
export function turnUser(state: NegotiationState, actor: Actor, lines: readonly Line[]): string {
  const brief = agentBrief(state, actor);
  const history = lines.length
    ? lines
        .map((l) => {
          const price = l.finalMinor != null ? ` (price on the table: ${formatMoney(l.finalMinor, state.currency)})` : "";
          return l.from === actor ? `You said: ${l.message}${price}` : `${wrapUntrusted("counterparty_message", l.message)}${price}`;
        })
        .join("\n")
    : "(No messages yet. You speak first.)";
  return `Negotiation brief (the only numbers you may rely on):
${JSON.stringify(brief, null, 2)}

Conversation so far:
${history}

Your turn.`;
}
