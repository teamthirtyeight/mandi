// Agent settings: what sellers and buyers can tune about their agent, with
// defaults, and how each setting changes behaviour. Prompts and the rule-based
// fallback both read from here so the agent behaves the same either way.
import { z } from "zod";

export const SellerAgentSettings = z.object({
  agentStyle: z.enum(["firm", "balanced", "flexible"]),
  offerGiftWrap: z.boolean(),
  offerBundles: z.boolean(),
  maxBundleDiscountPct: z.number().int().min(0).max(30),
  agentNote: z.string().trim().max(300).nullable(),
});
export type SellerAgentSettings = z.infer<typeof SellerAgentSettings>;

export const BuyerAgentSettings = z.object({
  agentStyle: z.enum(["patient", "balanced", "quick"]),
  maxSellers: z.number().int().min(1).max(3),
  acceptBundles: z.boolean(),
  priority: z.enum(["price", "balanced", "delivery"]),
});
export type BuyerAgentSettings = z.infer<typeof BuyerAgentSettings>;

export const DEFAULT_SELLER: SellerAgentSettings = {
  agentStyle: "balanced",
  offerGiftWrap: true,
  offerBundles: true,
  maxBundleDiscountPct: 15,
  agentNote: null,
};
export const DEFAULT_BUYER: BuyerAgentSettings = { agentStyle: "balanced", maxSellers: 3, acceptBundles: true, priority: "balanced" };

/** Share of the remaining gap each side gives up per turn (rule-based fallback). */
export const SELLER_CONCESSION = { firm: 0.2, balanced: 0.35, flexible: 0.5 } as const;
export const BUYER_CONCESSION = { patient: 0.25, balanced: 0.4, quick: 0.6 } as const;

export const SELLER_STYLE_PROMPT = {
  firm: "Hold your price: concede only small amounts and only when the buyer moves too. Prefer adding value over cutting price.",
  balanced: "Concede in shrinking steps.",
  flexible: "Close the sale: concede readily towards a fair middle so the buyer agrees within a few rounds.",
} as const;
export const BUYER_STYLE_PROMPT = {
  patient: "Haggle patiently: move up in small steps and be ready to use all the rounds.",
  balanced: "Concede slowly.",
  quick: "Aim to agree quickly: make reasonable steps towards the seller and accept a fair price early.",
} as const;

/** Scoring weights for the recommendation: price, delivery slack, match. */
export const PRIORITY_WEIGHTS = {
  price: { price: 0.8, delivery: 0.1, match: 0.1 },
  balanced: { price: 0.6, delivery: 0.3, match: 0.1 },
  delivery: { price: 0.35, delivery: 0.55, match: 0.1 },
} as const;
