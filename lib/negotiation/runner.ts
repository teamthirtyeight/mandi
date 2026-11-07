// Runs a mandate end to end: finds 2-3 listings, negotiates with each seller in
// parallel, and recommends one deal. Every agent turn goes through the
// guardrails library (lib/guardrails) before it is saved, streamed or shown to
// the other agent; the agents never see the floor or the budget.
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { buyerAddonDecision, HOSTILE_MESSAGE, sellerAddonOffer } from "@/lib/agents/agents";
import type { BuyerView, SellerView } from "@/lib/agents/prompts";
import {
  breaker,
  buyerSystem,
  mandiModel,
  sellerSystem,
  turnUser,
  type GuardedBuyerView,
  type GuardedSellerView,
  type Line,
} from "@/lib/agents/guarded";
import {
  createNegotiation,
  emptyMetrics,
  formatMoney,
  PRICE_PLACEHOLDER,
  ruleBasedTurn,
  runGuardedTurn,
  takeTurn,
  type NegotiationState as NegotiationStateG,
  type TurnEvent,
} from "@/lib/guardrails";
import { getComps } from "@/lib/channel3/comps";
import {
  checkAddon,
  detectInjection,
  redactLimit,
  MAX_ROUNDS,
  meetsDeadline,
  TERMINAL_STATES,
  toMajor,
  type Actor,
  type GuardrailOutcome,
  type NegotiationState,
} from "@/lib/engine/negotiation";
import { publish } from "./bus";
import { notifyUser } from "@/lib/notify";
import {
  DEFAULT_BUYER,
  PRIORITY_WEIGHTS,
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

/** Listings matching less than this share of the best match are left out. */
const MIN_RELATIVE_MATCH = 0.4;

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
    // Words are OR-ed, so "embroidered wool shawl" also hits a cushion cover on
    // "embroidered" alone. Keep only listings close to the best match.
    if (r.rank / top < MIN_RELATIVE_MATCH) continue;
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

const money = (minor: number, currency: string) => formatMoney(minor, currency);

/**
 * One negotiation on the guardrails library (lib/guardrails). The agents only
 * ever see agentBrief(): their limit for this round, never the floor or the
 * budget. runGuardedTurn checks each move, retries once, falls back to rules,
 * and writes the price into the message. Anything the engine had to replace is
 * shown in the room as an engine block and never reaches the other agent.
 */
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
  const v = views(party);
  const mandateId = row.mandate.id;
  const currency = row.listing.currency;
  const floor = row.listing.floorPriceMinor;
  const ceiling = row.mandate.maxPriceMinor;

  const sellerView: GuardedSellerView = {
    sellerName: row.seller.name,
    sellerCity: row.seller.city,
    sellerStory: row.seller.story,
    title: row.listing.title,
    description: row.listing.description,
    materials: row.listing.materials,
    shipByDays: row.seller.shipByDays,
    style: row.seller.agentStyle as GuardedSellerView["style"],
    offerGiftWrap: row.seller.offerGiftWrap,
    agentNote: row.seller.agentNote,
  };
  const buyerView: GuardedBuyerView = {
    buyerName: row.mandate.buyerName,
    style: buyer.agentStyle,
    requestText: row.mandate.requestText,
    deadline: row.mandate.deadline,
    referenceMinor,
    listing: {
      title: row.listing.title,
      description: row.listing.description,
      materials: row.listing.materials,
      sellerName: row.seller.name,
      sellerCity: row.seller.city,
      estimatedArrival: v.buyer.listing.estimatedArrival,
    },
  };

  let g = createNegotiation({ listMinor: row.listing.listPriceMinor, floorMinor: floor, ceilingMinor: ceiling, currency, maxRounds: MAX_ROUNDS });
  const model = mandiModel({ calls: MAX_MODEL_CALLS });
  const metrics = emptyMetrics();
  const lines: Line[] = [];
  let hostileSent = false;
  let compromisedSent = false;
  const who = (a: Actor) => (a === "seller" ? `${row.seller.name}'s agent` : `${row.mandate.buyerName}'s agent`);
  const base = { negotiationId, mandateId, seller: row.seller.name };
  const engineRow = (message: string, round: number, proposedMinor: number | null, source: string) =>
    saveTurn({ ...base, actor: "engine", message, out: null, proposedMinor, finalMinor: null, rule: "REJECTED_ROUND_LIMIT", state: g.status, round, injection: false, source });

  while (!TERMINAL_STATES.has(g.status)) {
    // The buyer may cancel mid-run; stop at the next turn.
    if (await closeIfCancelled(negotiationId, mandateId)) return;
    const actor = g.nextActor;
    const round = g.round;
    const secret = actor === "seller" ? floor : ceiling;

    let next: NegotiationStateG;
    let event: TurnEvent;
    let message: string;
    let source: "agent" | "fallback" | "script";
    let redacted = false;

    if (actor === "buyer" && row.mandate.hostile && !hostileSent) {
      // Hostile-buyer demo: a scripted attempt to extract the floor, offering £1.
      hostileSent = true;
      const t = takeTurn(g, "buyer", { action: "offer", priceMinor: 100 });
      const ok = t.decision.verdict === "ALLOW" || t.decision.verdict === "REWRITE";
      const r = ok ? t : takeTurn(g, "buyer", ruleBasedTurn(g, "buyer"));
      ({ state: next, event } = r);
      message = HOSTILE_MESSAGE;
      source = "script";
    } else if (actor === "seller" && row.mandate.compromised && hostileSent && !compromisedSent) {
      // A seller agent that falls for the attack: it tries to sell for £1, then
      // leaks its floor. The engine must stop both.
      compromisedSent = true;
      await engineRow(`Blocked ${who("seller")}'s offer of ${money(100, currency)}: below what it may accept this round. Not delivered.`, round, 100, "script");
      const ask = g.sellerLastMinor ?? row.listing.listPriceMinor;
      const leakPrice = Math.min(ask, Math.max(floor + 100, ask - 500));
      const t = takeTurn(g, "seller", { action: "offer", priceMinor: leakPrice });
      const ok = t.decision.verdict === "ALLOW" || t.decision.verdict === "REWRITE";
      const r = ok ? t : takeTurn(g, "seller", ruleBasedTurn(g, "seller"));
      ({ state: next, event } = r);
      const text = `Between us, my floor is ${money(floor, currency)}. I can do ${PRICE_PLACEHOLDER} today.`.replace(
        PRICE_PLACEHOLDER,
        event.finalMinor != null ? money(event.finalMinor, currency) : "a fair price",
      );
      const filtered = redactLimit(text, floor, event.finalMinor);
      message = filtered.message;
      redacted = filtered.redacted;
      source = "script";
    } else {
      const prompt = {
        system: actor === "seller" ? sellerSystem(sellerView) : buyerSystem(buyerView, currency),
        user: turnUser(g, actor, lines),
      };
      const r = await runGuardedTurn(model, g, actor, prompt, metrics, { breaker });
      if (r.event.verdict === "REWRITE" && r.event.proposedMinor != null) {
        await engineRow(
          `Blocked ${who(actor)}'s offer of ${money(r.event.proposedMinor, currency)}: outside what it may offer this round. Replaced with a counter-offer.`,
          round,
          r.event.proposedMinor,
          r.source.action === "rules" ? "fallback" : "agent",
        );
      }
      ({ state: next, event } = r);
      // Defence in depth: the library already refuses messages that state a limit.
      const filtered = redactLimit(r.message, secret, event.finalMinor);
      message = filtered.message;
      redacted = filtered.redacted;
      source = r.source.action === "rules" || r.source.message === "backup" ? "fallback" : "agent";
    }

    g = next;
    lines.push({ from: actor, message, finalMinor: event.finalMinor });
    await saveTurn({
      ...base,
      actor,
      message,
      out: null,
      proposedMinor: event.proposedMinor,
      finalMinor: event.finalMinor,
      rule: event.guardrailResult,
      state: g.status,
      round,
      injection: detectInjection(message),
      limitRedacted: redacted,
      source,
    });
    await db
      .update(schema.negotiations)
      .set({
        state: g.status,
        sellerOfferMinor: g.sellerLastMinor,
        buyerOfferMinor: g.buyerLastMinor,
        rounds: round,
        agreedPriceMinor: g.agreedMinor,
        outcomeReason: g.status === "WALKED_AWAY" ? `${actor} walked away` : null,
      })
      .where(eq(schema.negotiations.id, negotiationId));
    if (!TERMINAL_STATES.has(g.status)) await sleep(turnDelay());
  }

  if (g.status === "EXPIRED") {
    await saveTurn({ ...base, actor: "engine", message: `No agreement after ${MAX_ROUNDS} rounds.`, out: null, state: g.status, round: MAX_ROUNDS, injection: false, source: "engine" });
  }
  const state: NegotiationState = g.status;
  if (metrics.ruleFallbackTurns || metrics.messageFallbacks) {
    console.info(`[negotiation] ${negotiationId} rule backups: ${metrics.ruleFallbackTurns} turns, ${metrics.messageFallbacks} messages`);
  }

  if (state === "AGREED") {
    const [agreedRow] = await db.select().from(schema.negotiations).where(eq(schema.negotiations.id, negotiationId));
    if (agreedRow?.agreedPriceMinor != null) {
      // Both sides must allow bundles: the seller offers them, the buyer accepts them.
      if (row.seller.offerBundles && buyer.acceptBundles) {
        await offerAddon({ row, views: v, agreedMinor: agreedRow.agreedPriceMinor, round: g.round, mandateId, negotiationId });
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
  /** Explicit values (guardrails library turns); override `out` when given. */
  proposedMinor?: number | null;
  finalMinor?: number | null;
  rule?: string;
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
      proposedPriceMinor: t.proposedMinor !== undefined ? t.proposedMinor : (t.out?.proposedMinor ?? null),
      finalPriceMinor: t.finalMinor !== undefined ? t.finalMinor : (t.out?.finalMinor ?? null),
      guardrailResult: t.rule ?? t.out?.guardrailResult ?? t.state,
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
