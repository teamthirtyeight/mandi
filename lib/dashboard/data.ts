// Seller dashboard data: listings, negotiations and orders for one seller,
// money held vs captured, and captured revenue by week. Prices in major units.
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { toMajor } from "@/lib/engine/negotiation";
import { weekStart } from "./weeks";
import { refreshPayouts } from "@/lib/orders/payout";

const WEEKS = 8;
const DAY = 24 * 60 * 60 * 1000;
const major = (m: number | null) => (m == null ? null : toMajor(m));

export async function getDashboard(sellerId: string, now = new Date()) {
  const [seller] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, sellerId));
  if (!seller) return null;

  const listings = await db
    .select()
    .from(schema.listings)
    .where(eq(schema.listings.sellerId, sellerId))
    .orderBy(asc(schema.listings.createdAt));

  const negs = await db
    .select({ n: schema.negotiations, listing: schema.listings, mandate: schema.mandates })
    .from(schema.negotiations)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .innerJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
    .where(eq(schema.listings.sellerId, sellerId))
    .orderBy(desc(schema.negotiations.createdAt));

  const orders = await db
    .select({ o: schema.orders, listing: schema.listings, mandate: schema.mandates })
    .from(schema.orders)
    .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .innerJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
    .where(eq(schema.listings.sellerId, sellerId))
    .orderBy(desc(schema.orders.createdAt));

  // Payouts PayPal is still processing: check them now, so the dashboard shows where the money is.
  const processing = orders.filter(({ o }) => o.payoutBatchId && o.payoutStatus && ["PENDING", "PROCESSING", "SENDING"].includes(o.payoutStatus));
  if (processing.length) {
    await refreshPayouts(processing.map(({ o }) => o.id));
    for (const r of orders) {
      if (!processing.some((p) => p.o.id === r.o.id)) continue;
      const [fresh] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.o.id));
      if (fresh) r.o = fresh;
    }
  }
  let paidOutMinor = 0;
  for (const { o } of orders) if (o.payoutMinor && o.payoutStatus && o.payoutStatus !== "FAILED") paidOutMinor += o.payoutMinor;

  const negCount = new Map<string, { total: number; agreed: number }>();
  for (const r of negs) {
    const c = negCount.get(r.listing.id) ?? { total: 0, agreed: 0 };
    c.total += 1;
    if (r.n.agreedPriceMinor != null) c.agreed += 1;
    negCount.set(r.listing.id, c);
  }

  let heldMinor = 0;
  let capturedMinor = 0;
  let refundedMinor = 0;
  const firstWeek = weekStart(new Date(now.getTime() - (WEEKS - 1) * 7 * DAY));
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({
    week: new Date(firstWeek.getTime() + i * 7 * DAY).toISOString().slice(0, 10),
    captured: 0,
  }));
  for (const { o } of orders) {
    if (o.status === "AUTHORIZED" || o.status === "SHIPPED") heldMinor += o.amountMinor;
    if (o.status === "CAPTURED" || o.status === "REFUNDED") {
      capturedMinor += o.amountMinor - o.refundedMinor;
      refundedMinor += o.refundedMinor;
    }
    // "Paid to you, by week" counts what actually reached the seller's PayPal,
    // the same money as the "Paid to you" total.
    if (o.paidOutAt && o.payoutMinor && o.payoutStatus && o.payoutStatus !== "FAILED") {
      const idx = Math.floor((weekStart(o.paidOutAt).getTime() - firstWeek.getTime()) / (7 * DAY));
      if (idx >= 0 && idx < WEEKS) weeks[idx].captured += toMajor(o.payoutMinor);
    }
  }

  const ACTIVE = new Set(["OPEN", "OFFERED", "COUNTERED", "AGREED", "AWAITING_BUYER_APPROVAL"]);

  return {
    seller: { id: seller.id, name: seller.name, city: seller.city, language: seller.language, shipByDays: seller.shipByDays },
    tiles: {
      held: toMajor(heldMinor),
      captured: toMajor(capturedMinor),
      refunded: toMajor(refundedMinor),
      paidOut: toMajor(paidOutMinor),
      payoutDebt: toMajor(seller.payoutDebtMinor),
      activeNegotiations: negs.filter((r) => ACTIVE.has(r.n.state)).length,
      /** Agreed by both agents, waiting for the buyer to approve in PayPal. */
      awaitingBuyer: negs.filter((r) => r.n.state === "AGREED" || r.n.state === "AWAITING_BUYER_APPROVAL").length,
      currency: "GBP",
    },
    listings: listings.map((l) => ({
      id: l.id,
      title: l.title,
      category: l.category,
      listPrice: toMajor(l.listPriceMinor),
      floorPrice: toMajor(l.floorPriceMinor),
      stock: l.stock,
      status: l.status,
      paypalProductId: l.paypalProductId,
      negotiations: negCount.get(l.id)?.total ?? 0,
      deals: negCount.get(l.id)?.agreed ?? 0,
    })),
    negotiations: negs.map((r) => ({
      id: r.n.id,
      mandateId: r.mandate.id,
      listing: r.listing.title,
      buyer: r.mandate.buyerName,
      state: r.n.state,
      rounds: r.n.rounds,
      ask: major(r.n.sellerOfferMinor),
      bid: major(r.n.buyerOfferMinor),
      agreed: major(r.n.agreedPriceMinor),
      floor: toMajor(r.listing.floorPriceMinor),
      // Margin above the private floor: agreed price if any, else the current ask.
      marginAboveFloor: major(
        (r.n.agreedPriceMinor ?? r.n.sellerOfferMinor) != null
          ? (r.n.agreedPriceMinor ?? r.n.sellerOfferMinor)! - r.listing.floorPriceMinor
          : null,
      ),
      createdAt: r.n.createdAt.toISOString(),
    })),
    orders: orders.map(({ o, listing, mandate }) => ({
      id: o.id,
      listing: listing.title,
      buyer: mandate.buyerName,
      amount: toMajor(o.amountMinor),
      refunded: toMajor(o.refundedMinor),
      floor: toMajor(listing.floorPriceMinor),
      marginAboveFloor: toMajor(o.amountMinor - listing.floorPriceMinor),
      pendingRefund: major(o.pendingRefundMinor),
      shipping: o.shipping,
      shipBy: o.authorizedAt ? new Date(o.authorizedAt.getTime() + seller.shipByDays * DAY).toISOString() : null,
      status: o.status,
      carrier: o.carrier,
      tracking: o.trackingNumber,
      authorizedAt: o.authorizedAt?.toISOString() ?? null,
      capturedAt: o.capturedAt?.toISOString() ?? null,
      payout: major(o.payoutMinor),
      fee: major(o.feeMinor),
      payoutStatus: o.payoutStatus,
      payoutBatchId: o.payoutBatchId,
      payoutError: o.payoutError,
    })),
    revenueByWeek: weeks,
  };
}

export type Dashboard = NonNullable<Awaited<ReturnType<typeof getDashboard>>>;
