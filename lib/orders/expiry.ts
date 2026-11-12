// Auto-void: if the seller hasn't shipped within their ship-by window, release
// the buyer's hold so they are never charged. PayPal authorizations only stay
// reliably capturable for a few days, so the window is kept short.
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { voidOrder } from "./service";
import { retryPayout } from "./payout";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SHIP_BY_DAYS = 3;

/** Ship-by window for an order. MANDIX_SHIP_WINDOW_MINUTES overrides it (for demos). */
function windowMs(shipByDays: number | null): number {
  const override = Number((process.env.MANDIX_SHIP_WINDOW_MINUTES ?? process.env.MANDI_SHIP_WINDOW_MINUTES));
  if (override > 0) return override * 60 * 1000;
  return (shipByDays ?? DEFAULT_SHIP_BY_DAYS) * DAY_MS;
}

const STUCK_MS = 10 * 60 * 1000;

/**
 * A capture or payout cut short (crash, deploy) leaves its claim behind: the
 * order sits in SHIPPED with no capture, or the payout in SENDING. Release
 * them. Both PayPal calls reuse their request id, so a step that did reach
 * PayPal is answered with the same result, never run twice.
 */
export async function releaseStuckOrders(now = new Date()): Promise<number> {
  const stale = or(isNull(schema.orders.claimedAt), lt(schema.orders.claimedAt, new Date(now.getTime() - STUCK_MS)));
  const unshipped = await db
    .update(schema.orders)
    .set({ status: "AUTHORIZED" })
    .where(and(eq(schema.orders.status, "SHIPPED"), isNull(schema.orders.captureId), stale))
    .returning({ id: schema.orders.id });
  const unpaid = await db
    .update(schema.orders)
    .set({ payoutStatus: "FAILED", payoutError: "Interrupted before PayPal answered; sending again." })
    .where(and(eq(schema.orders.payoutStatus, "SENDING"), stale))
    .returning({ id: schema.orders.id });
  for (const o of unpaid) await retryPayout(o.id).catch((err) => console.error(`[expiry] payout retry failed ${o.id}`, err));
  return unshipped.length + unpaid.length;
}

export async function voidExpiredHolds(now = new Date()): Promise<string[]> {
  await releaseStuckOrders(now).catch((err) => console.error("[expiry] stuck-order sweep failed", err));
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
