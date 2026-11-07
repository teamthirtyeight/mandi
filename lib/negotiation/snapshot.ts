// Everything the negotiation room needs to render a mandate from scratch:
// the mandate, one entry per negotiation (public listing fields only) and all
// turns so far. Seller floors are never included.
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { toMajor } from "@/lib/engine/negotiation";
import { turnEvent } from "./runner";

export async function getMandateSnapshot(mandateId: string) {
  const [mandate] = await db.select().from(schema.mandates).where(eq(schema.mandates.id, mandateId));
  if (!mandate) return null;

  const negs = await db
    .select({ n: schema.negotiations, listing: schema.listings, seller: schema.sellers })
    .from(schema.negotiations)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(eq(schema.negotiations.mandateId, mandateId))
    .orderBy(asc(schema.negotiations.createdAt));

  const ids = negs.map((r) => r.n.id);
  const turns = ids.length
    ? await db
        .select()
        .from(schema.negotiationTurns)
        .where(inArray(schema.negotiationTurns.negotiationId, ids))
        .orderBy(asc(schema.negotiationTurns.createdAt))
    : [];

  const byId = new Map(negs.map((r) => [r.n.id, r]));
  const addonIds = negs.map((r) => r.n.addonListingId).filter((x): x is string => x != null);
  const addonTitles = new Map(
    addonIds.length
      ? (await db.select({ id: schema.listings.id, title: schema.listings.title }).from(schema.listings).where(inArray(schema.listings.id, addonIds))).map(
          (l) => [l.id, l.title] as const,
        )
      : [],
  );
  // A paid order on any of these negotiations, so a reload shows "held" instead
  // of offering to pay again. Unpaid (CREATED) and voided orders don't count.
  const [order] = ids.length
    ? await db
        .select({ id: schema.orders.id, negotiationId: schema.orders.negotiationId, amountMinor: schema.orders.amountMinor, status: schema.orders.status })
        .from(schema.orders)
        .where(and(inArray(schema.orders.negotiationId, ids), inArray(schema.orders.status, ["AUTHORIZED", "SHIPPED", "CAPTURED", "REFUNDED"])))
        .orderBy(desc(schema.orders.createdAt))
        .limit(1)
    : [];

  return {
    order: order ? { id: order.id, negotiationId: order.negotiationId!, amount: toMajor(order.amountMinor), status: order.status } : null,
    mandate: {
      id: mandate.id,
      buyerName: mandate.buyerName,
      requestText: mandate.requestText,
      query: mandate.query,
      maxPrice: toMajor(mandate.maxPriceMinor),
      currency: mandate.currency,
      deadline: mandate.deadline,
      shipToCountry: mandate.shipToCountry,
      hostile: mandate.hostile,
      compromised: mandate.compromised,
      status: mandate.status,
      recommendedNegotiationId: mandate.recommendedNegotiationId,
      recommendation: mandate.recommendation,
    },
    negotiations: negs.map((r) => ({
      id: r.n.id,
      state: r.n.state,
      rounds: r.n.rounds,
      agreedPrice: r.n.agreedPriceMinor != null ? toMajor(r.n.agreedPriceMinor) : null,
      addon:
        r.n.addonListingId && r.n.addonPriceMinor != null
          ? { title: addonTitles.get(r.n.addonListingId) ?? "second item", price: toMajor(r.n.addonPriceMinor) }
          : null,
      outcomeReason: r.n.outcomeReason,
      listing: {
        id: r.listing.id,
        title: r.listing.title,
        listPrice: toMajor(r.listing.listPriceMinor),
        currency: r.listing.currency,
        image: r.listing.images[0] ?? null,
      },
      seller: { name: r.seller.name, city: r.seller.city },
    })),
    turns: turns.map((t) => turnEvent(t, byId.get(t.negotiationId)!.seller.name, byId.get(t.negotiationId)!.n.state)),
  };
}

export type MandateSnapshot = NonNullable<Awaited<ReturnType<typeof getMandateSnapshot>>>;
