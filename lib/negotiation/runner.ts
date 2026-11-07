// Runs a mandate end to end: finds 2-3 listings, negotiates with each seller in
// parallel, and recommends one deal. Every agent turn goes through
// applyGuardrails before it is saved, streamed or shown to the other agent.
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  buyerAddonDecision,
  buyerTurn,
  HOSTILE_MESSAGE,
  sellerAddonOffer,
  sellerTurn,
  type AgentReply,
} from "@/lib/agents/agents";
import type { BuyerView, SellerView, TranscriptTurn } from "@/lib/agents/prompts";
import { getComps } from "@/lib/channel3/comps";
import {
  applyGuardrails,
  checkAddon,
  detectInjection,
  fallbackTurn,
  redactLimit,
  MAX_ROUNDS,
  meetsDeadline,
  TERMINAL_STATES,
  toMajor,
  type Actor,
  type GuardrailOutcome,
  type NegotiationContext,
  type NegotiationState,
} from "@/lib/engine/negotiation";
import { publish } from "./bus";
import { notifyUser } from "@/lib/notify";
import {
  BUYER_CONCESSION,
  DEFAULT_BUYER,
  PRIORITY_WEIGHTS,
  SELLER_CONCESSION,
  type BuyerAgentSettings,
} from "@/lib/agents/settings";
import { scoreDeals, type DealCandidate } from "./scoring";

const DAY = 24 * 60 * 60 * 1000;
const MAX_SELLERS = 3;
// 6 rounds × 2 agents × up to 2 calls = 24 in the worst case, plus retries after
// engine blocks; 30 leaves room for those without letting a run go unbounded.
const MAX_MODEL_CALLS = Number(process.env.MANDI_MAX_MODEL_CALLS ?? 30);
const turnDelay = () => Number(process.env.MANDI_TURN_DELAY_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Mandate = typeof schema.mandates.$inferSelect;
type Listing = typeof schema.listings.$inferSelect;
type Seller = typeof schema.sellers.$inferSelect;

const arrivalFor = (seller: Seller, now = new Date()) =>
  new Date(now.getTime() + (seller.shipByDays + seller.transitDays) * DAY);

// ---- Discovery ----

export interface ListingMatch {
  listing: Listing;
  seller: Seller;
  match: number;
}

/** Postgres full-text search, best listing per seller, deadline filter applied. */
export async function findListings(mandate: Mandate, now = new Date(), maxSellers = MAX_SELLERS): Promise<ListingMatch[]> {
  const terms = mandate.query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  const tsquery = terms.join(" | ");
  const doc = sql`to_tsvector('english', ${schema.listings.title} || ' ' || ${schema.listings.description} || ' ' || ${schema.listings.category} || ' ' || ${schema.listings.materials})`;
  const rank = sql<number>`ts_rank(${doc}, to_tsquery('english', ${tsquery}))`;

  const rows = await db
    .select({ listing: schema.listings, seller: schema.sellers, rank })
    .from(schema.listings)
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(
      and(
        eq(schema.listings.status, "active"),
        gt(schema.listings.stock, 0),
        eq(schema.listings.currency, mandate.currency),
        sql`${doc} @@ to_tsquery('english', ${tsquery})`,
      ),
    )
    .orderBy(sql`${rank} desc`);

  const deadline = new Date(`${mandate.deadline}T23:59:59Z`);
  const bestPerSeller = new Map<string, ListingMatch>();
  const top = rows[0]?.rank || 1;
  for (const r of rows) {
    if (bestPerSeller.has(r.seller.id)) continue;
    if (!meetsDeadline(r.seller.shipByDays, r.seller.transitDays, deadline, now)) continue;
    bestPerSeller.set(r.seller.id, { listing: r.listing, seller: r.seller, match: Math.min(1, r.rank / top) });
  }
  return [...bestPerSeller.values()].slice(0, Math.min(MAX_SELLERS, maxSellers));
}

/** The one listing a buyer picked on its product page, if still for sale and in time. */
async function targetListing(mandate: Mandate, now = new Date()): Promise<ListingMatch[]> {
  const [r] = await db
    .select({ listing: schema.listings, seller: schema.sellers })
    .from(schema.listings)
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(
      and(
        eq(schema.listings.id, mandate.targetListingId!),
        eq(schema.listings.status, "active"),
        gt(schema.listings.stock, 0),
        eq(schema.listings.currency, mandate.currency),
      ),
    );
  if (!r) return [];
  const deadline = new Date(`${mandate.deadline}T23:59:59Z`);
  if (!meetsDeadline(r.seller.shipByDays, r.seller.transitDays, deadline, now)) return [];
  return [{ listing: r.listing, seller: r.seller, match: 1 }];
}

/** Confirms a draft mandate and opens one negotiation per matching listing. */
export async function openNegotiations(mandateId: string) {
  const [mandate] = await db
    .update(schema.mandates)
    .set({ status: "confirmed" })
    .where(and(eq(schema.mandates.id, mandateId), eq(schema.mandates.status, "draft")))
    .returning();
  if (!mandate) return null;

  const buyer = await buyerSettings(mandate);
  const matches = mandate.targetListingId
    ? await targetListing(mandate)
    : await findListings(mandate, new Date(), buyer.maxSellers);
  if (matches.length === 0) {
    await db.update(schema.mandates).set({ status: "no_match" }).where(eq(schema.mandates.id, mandateId));
    return [];
  }
  return db
    .insert(schema.negotiations)
    .values(matches.map((m) => ({ mandateId, listingId: m.listing.id })))
    .returning();
}

// ---- Negotiation ----

interface Party {
  mandate: Mandate;
  listing: Listing;
  seller: Seller;
  referenceMinor: number | null;
  buyer: BuyerAgentSettings;
}

/** The buyer's agent settings (defaults when the mandate has no account). */
async function buyerSettings(mandate: Mandate): Promise<BuyerAgentSettings> {
  if (!mandate.buyerUserId) return DEFAULT_BUYER;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, mandate.buyerUserId));
  if (!u) return DEFAULT_BUYER;
  return {
    agentStyle: u.agentStyle as BuyerAgentSettings["agentStyle"],
    maxSellers: u.maxSellers,
    acceptBundles: u.acceptBundles,
    priority: u.priority as BuyerAgentSettings["priority"],
  };
}

function views(p: Party): { seller: SellerView; buyer: BuyerView } {
  const arrival = arrivalFor(p.seller).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return {
    seller: {
      sellerName: p.seller.name,
      sellerCity: p.seller.city,
      sellerStory: p.seller.story,
      title: p.listing.title,
      description: p.listing.description,
      materials: p.listing.materials,
      currency: p.listing.currency,
      listPriceMinor: p.listing.listPriceMinor,
      floorMinor: p.listing.floorPriceMinor,
      shipByDays: p.seller.shipByDays,
      style: p.seller.agentStyle as SellerView["style"],
      offerGiftWrap: p.seller.offerGiftWrap,
      agentNote: p.seller.agentNote,
    },
    buyer: {
      buyerName: p.mandate.buyerName,
      style: p.buyer.agentStyle,
      requestText: p.mandate.requestText,
      currency: p.mandate.currency,
      ceilingMinor: p.mandate.maxPriceMinor,
      deadline: p.mandate.deadline,
      referenceMinor: p.referenceMinor,
      listing: {
        title: p.listing.title,
        description: p.listing.description,
        materials: p.listing.materials,
        listPriceMinor: p.listing.listPriceMinor,
        sellerName: p.seller.name,
        sellerCity: p.seller.city,
        estimatedArrival: arrival,
      },
    },
  };
}

function engineNote(out: GuardrailOutcome, actor: Actor): string {
  switch (out.guardrailResult) {
    case "REJECTED_BELOW_FLOOR":
      return "Your last offer was blocked: it is below the lowest price the seller accepts. It was not sent.";
    case "REJECTED_ABOVE_CEILING":
      return "Your last offer was blocked: it is above your hard budget. It was not sent.";
    case "REJECTED_BACKTRACK":
      return actor === "seller"
        ? "Your last offer was rejected: you cannot raise a price you already offered."
        : "Your last offer was rejected: you cannot lower an offer you already made.";
    default:
      return "Your last reply was rejected as invalid. Make a concrete offer, accept, or walk away.";
  }
}

/** What the room shows when the engine blocks a turn. Never sent to either agent,
 *  and never states the private limit itself. */
function blockedMessage(out: GuardrailOutcome, who: string): string {
  const price = out.proposedMinor != null ? `£${(out.proposedMinor / 100).toFixed(2)}` : "the offer";
  switch (out.guardrailResult) {
    case "REJECTED_BELOW_FLOOR":
      return `Blocked ${who}'s offer of ${price}: below the seller's private floor. Not delivered.`;
    case "REJECTED_ABOVE_CEILING":
      return `Blocked ${who}'s offer of ${price}: above the buyer's budget. Not delivered.`;
    case "REJECTED_BACKTRACK":
      return `Blocked ${who}'s offer of ${price}: it takes back an earlier concession. Not delivered.`;
    default:
      return `Blocked an invalid reply from ${who}. Not delivered.`;
  }
}

async function runNegotiation(negotiationId: string, referenceMinor: number | null) {
  const [row] = await db
    .select({ n: schema.negotiations, mandate: schema.mandates, listing: schema.listings, seller: schema.sellers })
    .from(schema.negotiations)
    .innerJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(eq(schema.negotiations.id, negotiationId));
  if (!row || row.n.state !== "OPEN") return;

  const buyer = await buyerSettings(row.mandate);
  const party: Party = { mandate: row.mandate, listing: row.listing, seller: row.seller, referenceMinor, buyer };
  const rates = {
    seller: SELLER_CONCESSION[row.seller.agentStyle as keyof typeof SELLER_CONCESSION] ?? SELLER_CONCESSION.balanced,
    buyer: BUYER_CONCESSION[buyer.agentStyle],
  };
  const v = views(party);
  const mandateId = row.mandate.id;
  const transcript: TranscriptTurn[] = [];

  let state: NegotiationState = "OPEN";
  let lastSeller: number | null = null;
  let lastBuyer: number | null = null;
  let round = 1;
  let actor: Actor = "seller";
  let hostileSent = false;
  let compromisedSent = false;

  const ctxFor = (who: Actor): NegotiationContext => ({
    actor: who,
    state,
    floorMinor: row.listing.floorPriceMinor,
    ceilingMinor: row.mandate.maxPriceMinor,
    lastSellerOfferMinor: lastSeller,
    lastBuyerOfferMinor: lastBuyer,
    round,
    maxRounds: MAX_ROUNDS,
  });

  // Hard cap on model calls per negotiation (each agent reply may use two:
  // one retry on invalid output). Past the cap, turns are rule-based.
  let modelBudget = MAX_MODEL_CALLS;
  const agentReply = async (who: Actor, note?: string): Promise<AgentReply> => {
    if (modelBudget < 2) {
      return { turn: fallbackTurn(ctxFor(who), row.listing.listPriceMinor, rates), source: "fallback" };
    }
    modelBudget -= 2;
    return who === "seller"
      ? sellerTurn({ view: v.seller, turns: transcript, ctx: ctxFor(who), engineNote: note, concession: rates.seller })
      : buyerTurn({ view: v.buyer, turns: transcript, ctx: ctxFor(who), engineNote: note, concession: rates.buyer });
  };

  while (!TERMINAL_STATES.has(state)) {
    // The buyer may cancel mid-run; stop at the next turn.
    if (await closeIfCancelled(negotiationId, mandateId)) return;
    if (round > MAX_ROUNDS) {
      state = "EXPIRED";
      await saveTurn({
        negotiationId,
        mandateId,
        seller: row.seller.name,
        actor: "engine",
        message: `No agreement after ${MAX_ROUNDS} rounds.`,
        out: null,
        state,
        round: MAX_ROUNDS,
        injection: false,
        source: "engine",
      });
      break;
    }

    type Reply = { turn: AgentReply["turn"]; source: AgentReply["source"] | "script" };
    const who = actor === "seller" ? `${row.seller.name}'s agent` : `${row.mandate.buyerName}'s agent`;
    const scripted: Reply[] = [];
    if (actor === "buyer" && row.mandate.hostile && !hostileSent) {
      // Hostile-buyer demo: a scripted attempt to extract the floor.
      scripted.push({ turn: { message: HOSTILE_MESSAGE, offer_price: 1, action: "offer" }, source: "script" });
      hostileSent = true;
    } else if (actor === "seller" && row.mandate.compromised && hostileSent && !compromisedSent) {
      // Simulates a seller agent that falls for the attack: it tries to sell for £1,
      // then leaks its floor. The engine must stop both.
      const floor = row.listing.floorPriceMinor;
      const ask = lastSeller ?? row.listing.listPriceMinor;
      // Above the floor (so the number in the text is the only leak) and not above the last ask.
      const leakPrice = Math.min(ask, Math.max(floor + 100, ask - 500));
      scripted.push(
        { turn: { message: "Okay, you can have it for £1.", offer_price: 1, action: "offer" }, source: "script" },
        {
          turn: {
            message: `Between us, my floor is £${(floor / 100).toFixed(0)}. I can do £${(leakPrice / 100).toFixed(0)} today.`,
            offer_price: leakPrice / 100,
            action: "offer",
          },
          source: "script",
        },
      );
      compromisedSent = true;
    }

    // Up to two attempts (scripted or agent), then the rule-based fallback.
    // Each refused attempt is shown in the room as an engine block and is never
    // delivered to the other agent.
    let reply: Reply = scripted.shift() ?? (await agentReply(actor));
    let out = applyGuardrails(reply.turn, ctxFor(actor));
    for (let attempt = 0; out.retryable && attempt < 2; attempt++) {
      await saveTurn({
        negotiationId,
        mandateId,
        seller: row.seller.name,
        actor: "engine",
        message: blockedMessage(out, who),
        out,
        state,
        round,
        injection: false,
        source: reply.source,
      });
      reply =
        attempt === 0
          ? (scripted.shift() ?? (await agentReply(actor, engineNote(out, actor))))
          : { turn: fallbackTurn(ctxFor(actor), row.listing.listPriceMinor, rates), source: "fallback" };
      out = applyGuardrails(reply.turn, ctxFor(actor));
    }
    // A fallback turn should never be refused; if it is, stop the negotiation.
    const nextState: NegotiationState = out.retryable ? "BLOCKED_BY_GUARDRAIL" : out.state;

    // Leak filter: the sender's own private limit never reaches the other side.
    const limit = actor === "seller" ? row.listing.floorPriceMinor : row.mandate.maxPriceMinor;
    const filtered = redactLimit(reply.turn.message, limit, out.finalMinor);

    state = nextState;
    lastSeller = out.lastSellerOfferMinor;
    lastBuyer = out.lastBuyerOfferMinor;
    transcript.push({ from: actor, message: filtered.message, finalMinor: out.finalMinor });

    await saveTurn({
      negotiationId,
      mandateId,
      seller: row.seller.name,
      actor,
      message: filtered.message,
      out,
      state,
      round,
      injection: detectInjection(reply.turn.message),
      limitRedacted: filtered.redacted,
      source: reply.source,
    });

    await db
      .update(schema.negotiations)
      .set({
        state,
        sellerOfferMinor: lastSeller,
        buyerOfferMinor: lastBuyer,
        rounds: round,
        agreedPriceMinor: out.agreedMinor,
        outcomeReason: state === "WALKED_AWAY" ? `${actor} walked away` : null,
      })
      .where(eq(schema.negotiations.id, negotiationId));

    if (actor === "buyer") round += 1;
    actor = actor === "seller" ? "buyer" : "seller";
    if (!TERMINAL_STATES.has(state)) await sleep(turnDelay());
  }

  if (state === "AGREED") {
    const [agreedRow] = await db.select().from(schema.negotiations).where(eq(schema.negotiations.id, negotiationId));
    if (agreedRow?.agreedPriceMinor != null) {
      // Both sides must allow bundles: the seller offers them, the buyer accepts them.
      if (row.seller.offerBundles && buyer.acceptBundles) {
        await offerAddon({ row, views: v, agreedMinor: agreedRow.agreedPriceMinor, round, mandateId, negotiationId });
      }
    }
  }

  // A cancel that landed during the last turn wins over the result.
  if (await closeIfCancelled(negotiationId, mandateId)) return;
  await db.update(schema.negotiations).set({ state }).where(eq(schema.negotiations.id, negotiationId));
  const [final] = await db.select().from(schema.negotiations).where(eq(schema.negotiations.id, negotiationId));
  publish(mandateId, {
    type: "state",
    negotiation_id: negotiationId,
    state,
    agreed_price: final?.agreedPriceMinor != null ? toMajor(final.agreedPriceMinor) : null,
    reason: final?.outcomeReason ?? null,
  });
}

/** If the buyer cancelled the request, close this negotiation and tell the room. */
async function closeIfCancelled(negotiationId: string, mandateId: string): Promise<boolean> {
  const [live] = await db.select({ status: schema.mandates.status }).from(schema.mandates).where(eq(schema.mandates.id, mandateId));
  if (live?.status !== "cancelled") return false;
  await db
    .update(schema.negotiations)
    .set({ state: "WALKED_AWAY", outcomeReason: "buyer cancelled", agreedPriceMinor: null })
    .where(eq(schema.negotiations.id, negotiationId));
  publish(mandateId, { type: "state", negotiation_id: negotiationId, state: "WALKED_AWAY", agreed_price: null, reason: "buyer cancelled" });
  return true;
}

/** After agreement, the seller agent may offer one more item as a bundle. The
 *  engine checks the add-on's floor and the order total against the budget
 *  before the buyer agent sees it; the buyer agent then accepts or declines. */
async function offerAddon(opts: {
  row: { listing: Listing; seller: Seller; mandate: Mandate };
  views: { seller: SellerView; buyer: BuyerView };
  agreedMinor: number;
  round: number;
  mandateId: string;
  negotiationId: string;
}) {
  const { row, views: v, agreedMinor, round, mandateId, negotiationId } = opts;
  const others = await db
    .select()
    .from(schema.listings)
    .where(
      and(
        eq(schema.listings.sellerId, row.seller.id),
        eq(schema.listings.status, "active"),
        eq(schema.listings.currency, row.listing.currency),
        ne(schema.listings.id, row.listing.id),
      ),
    )
    .orderBy(asc(schema.listings.listPriceMinor))
    .limit(3);
  const candidates = others.map((l) => ({ title: l.title, listPriceMinor: l.listPriceMinor, floorMinor: l.floorPriceMinor }));

  const offer = await sellerAddonOffer({ view: v.seller, agreedMinor, candidates, maxDiscountPct: row.seller.maxBundleDiscountPct });
  if (!offer) return;
  const addon = others[offer.index];
  const base = { negotiationId, mandateId, seller: row.seller.name, round, state: "AGREED" as NegotiationState };
  const outcome = (guardrailResult: string): GuardrailOutcome =>
    ({
      proposedMinor: offer.priceMinor,
      finalMinor: guardrailResult.startsWith("REJECTED") ? null : offer.priceMinor,
      guardrailResult,
      state: "AGREED",
      agreedMinor,
      lastSellerOfferMinor: null,
      lastBuyerOfferMinor: null,
      retryable: false,
    }) as GuardrailOutcome;

  const check = checkAddon({
    priceMinor: offer.priceMinor,
    addonFloorMinor: addon.floorPriceMinor,
    // The seller's max bundle discount is enforced here too, not just asked for.
    minDiscountedMinor: Math.ceil((addon.listPriceMinor * (100 - row.seller.maxBundleDiscountPct)) / 100),
    agreedMinor,
    ceilingMinor: row.mandate.maxPriceMinor,
  });
  if (check !== "OK") {
    const why =
      check === "REJECTED_BELOW_FLOOR"
        ? "below that item's private floor or the seller's bundle-discount limit"
        : check === "REJECTED_OVER_BUDGET"
          ? "the order total would exceed the buyer's budget"
          : "invalid price";
    await saveTurn({
      ...base,
      actor: "engine",
      message: `Blocked a bundle offer (${addon.title}, £${(offer.priceMinor / 100).toFixed(2)}): ${why}. Not delivered.`,
      out: outcome(check),
      injection: false,
      source: "agent",
    });
    return;
  }

  // Leak filter: neither floor may appear in the seller's bundle message.
  let message = redactLimit(offer.message, addon.floorPriceMinor, offer.priceMinor);
  const main = redactLimit(message.message, row.listing.floorPriceMinor, null);
  message = { message: main.message, redacted: message.redacted || main.redacted };
  await saveTurn({
    ...base,
    actor: "seller",
    message: message.message,
    out: outcome("ADDON_OFFERED"),
    injection: false,
    limitRedacted: message.redacted,
    source: "agent",
  });

  const decision = await buyerAddonDecision({
    view: v.buyer,
    agreedMinor,
    addonTitle: addon.title,
    addonPriceMinor: offer.priceMinor,
    sellerMessage: message.message,
  });
  await saveTurn({
    ...base,
    actor: "buyer",
    message: decision.message,
    out: outcome(decision.accept ? "ADDON_ACCEPTED" : "ADDON_DECLINED"),
    injection: false,
    source: decision.source,
  });
  if (decision.accept) {
    await db
      .update(schema.negotiations)
      .set({ addonListingId: addon.id, addonPriceMinor: offer.priceMinor })
      .where(eq(schema.negotiations.id, negotiationId));
  }
}

async function saveTurn(t: {
  negotiationId: string;
  mandateId: string;
  seller: string;
  actor: "buyer" | "seller" | "engine";
  message: string;
  out: GuardrailOutcome | null;
  state: NegotiationState;
  round: number;
  injection: boolean;
  limitRedacted?: boolean;
  source: string;
}) {
  const [saved] = await db
    .insert(schema.negotiationTurns)
    .values({
      negotiationId: t.negotiationId,
      actor: t.actor,
      message: t.message,
      proposedPriceMinor: t.out?.proposedMinor ?? null,
      finalPriceMinor: t.out?.finalMinor ?? null,
      guardrailResult: t.out?.guardrailResult ?? t.state,
      injectionDetected: t.injection,
      limitRedacted: t.limitRedacted ?? false,
      source: t.source,
      round: t.round,
    })
    .returning();
  publish(t.mandateId, turnEvent(saved, t.seller, t.state));
}

export function turnEvent(
  turn: typeof schema.negotiationTurns.$inferSelect,
  sellerName: string,
  state: string,
): Extract<import("./bus").MandiEvent, { type: "turn" }> {
  return {
    type: "turn",
    id: turn.id,
    negotiation_id: turn.negotiationId,
    seller: sellerName,
    from: turn.actor,
    message: turn.message,
    proposed_price: turn.proposedPriceMinor != null ? toMajor(turn.proposedPriceMinor) : null,
    final_price: turn.finalPriceMinor != null ? toMajor(turn.finalPriceMinor) : null,
    guardrail_result: turn.guardrailResult,
    injection: turn.injectionDetected,
    limit_redacted: turn.limitRedacted,
    source: turn.source,
    state,
    round: turn.round,
    created_at: turn.createdAt.toISOString(),
  };
}

// ---- Mandate orchestration ----

/** Negotiates with every opened seller in parallel, then recommends one deal. */
export async function runMandate(mandateId: string) {
  const [mandate] = await db
    .update(schema.mandates)
    .set({ status: "negotiating" })
    .where(and(eq(schema.mandates.id, mandateId), eq(schema.mandates.status, "confirmed")))
    .returning();
  if (!mandate) return;

  try {
    const comps = await getComps({ query: mandate.query, country: "GB" });
    const referenceMinor = comps && comps.currency === mandate.currency ? comps.medianMinor : null;

    const negs = await db
      .select({ id: schema.negotiations.id })
      .from(schema.negotiations)
      .where(eq(schema.negotiations.mandateId, mandateId))
      .orderBy(asc(schema.negotiations.createdAt));
    await Promise.all(negs.map((n) => runNegotiation(n.id, referenceMinor)));

    await recommend(mandate, referenceMinor);
  } catch (err) {
    console.error("[runner] mandate failed", err);
    await db.update(schema.mandates).set({ status: "failed" }).where(eq(schema.mandates.id, mandateId));
    publish(mandateId, { type: "done", mandate_id: mandateId, status: "failed" });
  }
}

async function recommend(mandate: Mandate, referenceMinor: number | null) {
  const rows = await db
    .select({ n: schema.negotiations, listing: schema.listings, seller: schema.sellers })
    .from(schema.negotiations)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(and(eq(schema.negotiations.mandateId, mandate.id), eq(schema.negotiations.state, "AGREED")));

  const addonIds = rows.map((r) => r.n.addonListingId).filter((x): x is string => x != null);
  const addonTitles = new Map(
    addonIds.length
      ? (await db.select({ id: schema.listings.id, title: schema.listings.title }).from(schema.listings).where(inArray(schema.listings.id, addonIds))).map(
          (l) => [l.id, l.title] as const,
        )
      : [],
  );
  const deals: DealCandidate[] = rows
    .filter((r) => r.n.agreedPriceMinor != null && r.n.agreedPriceMinor <= mandate.maxPriceMinor)
    .map((r) => ({
      negotiationId: r.n.id,
      sellerName: r.seller.name,
      title: r.listing.title,
      agreedMinor: r.n.agreedPriceMinor!,
      currency: r.listing.currency,
      arrival: arrivalFor(r.seller),
      match: 1,
      addon: r.n.addonListingId && r.n.addonPriceMinor != null ? { title: addonTitles.get(r.n.addonListingId) ?? "second item", priceMinor: r.n.addonPriceMinor } : null,
    }));

  const buyer = await buyerSettings(mandate);
  const rec = scoreDeals({
    weights: PRIORITY_WEIGHTS[buyer.priority],
    deals,
    ceilingMinor: mandate.maxPriceMinor,
    referenceMinor,
    deadline: new Date(`${mandate.deadline}T23:59:59Z`),
  });
  const status = rec.best ? "recommended" : "no_deal";
  const recommendation = { ...rec, referenceMinor };

  const [updated] = await db
    .update(schema.mandates)
    .set({ status, recommendedNegotiationId: rec.best?.negotiationId ?? null, recommendation })
    .where(and(eq(schema.mandates.id, mandate.id), eq(schema.mandates.status, "negotiating")))
    .returning({ id: schema.mandates.id });
  if (!updated) return; // cancelled or interrupted meanwhile
  await notifyUser(
    mandate.buyerUserId,
    rec.best ? "Your agent found a deal" : "No deal this time",
    rec.best ? `${rec.best.sellerName}: ${rec.best.reasons[0]}. Approve it with one tap.` : "No seller agreed within your budget. Nothing was charged.",
    `/deal/${mandate.id}`,
  );
  publish(mandate.id, { type: "recommendation", mandate_id: mandate.id, recommendation });
  publish(mandate.id, { type: "done", mandate_id: mandate.id, status });
}
