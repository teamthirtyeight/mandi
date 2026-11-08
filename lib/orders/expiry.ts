// Auto-void: if the seller hasn't shipped within their ship-by window, release
// the buyer's hold so they are never charged. PayPal authorizations only stay
// reliably capturable for a few days, so the window is kept short.
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { voidOrder } from "./service";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SHIP_BY_DAYS = 3;

/** Ship-by window for an order. MANDIX_SHIP_WINDOW_MINUTES overrides it (for demos). */
function windowMs(shipByDays: number | null): number {
  const override = Number((process.env.MANDIX_SHIP_WINDOW_MINUTES ?? process.env.MANDI_SHIP_WINDOW_MINUTES));
  if (override > 0) return override * 60 * 1000;
  return (shipByDays ?? DEFAULT_SHIP_BY_DAYS) * DAY_MS;
}

export async function voidExpiredHolds(now = new Date()): Promise<string[]> {
  // Anything authorized before the shortest possible window is a candidate.
  const candidates = await db
    .select({ id: schema.orders.id, authorizedAt: schema.orders.authorizedAt, shipByDays: schema.sellers.shipByDays })
    .from(schema.orders)
    .leftJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .leftJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .leftJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(and(eq(schema.orders.status, "AUTHORIZED"), lt(schema.orders.authorizedAt, now)));

  const voided: string[] = [];
  for (const c of candidates) {
    if (!c.authorizedAt || c.authorizedAt.getTime() + windowMs(c.shipByDays) > now.getTime()) continue;
    try {
      await voidOrder(c.id);
      voided.push(c.id);
    } catch (err) {
      console.error(`[expiry] could not void ${c.id}`, err);
    }
  }
  return voided;
}
