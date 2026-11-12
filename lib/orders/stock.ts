// Stock for one-of-a-kind items. Taken when the buyer's money is held (just
// before PayPal authorize), so two buyers can't both pay for the last piece;
// given back if the hold is voided. A listing at 0 is marked sold and drops
// out of search.
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

async function listingIdsFor(orderId: string): Promise<string[]> {
  const [row] = await db
    .select({ main: schema.negotiations.listingId, addon: schema.negotiations.addonListingId })
    .from(schema.orders)
    .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .where(eq(schema.orders.id, orderId));
  return row ? [row.main, ...(row.addon ? [row.addon] : [])] : [];
}

/** True if the order holds its stock; false (and nothing taken) if any item is sold out. */
export async function reserveStock(orderId: string): Promise<boolean> {
  return (await takeStock(orderId)) !== "sold_out";
}

/**
 * Takes one unit of each item. "taken": this call took it, and only this call
 * may give it back if its payment then fails. "held": an earlier call did.
 */
export async function takeStock(orderId: string): Promise<"taken" | "held" | "sold_out"> {
  const ids = await listingIdsFor(orderId);
  if (ids.length === 0) return "held"; // test orders have no listing
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(schema.orders)
      .set({ stockReserved: true })
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.stockReserved, false)))
      .returning({ id: schema.orders.id });
    if (!claimed) return "held" as const; // already reserved (retry or double click)
    for (const id of ids) {
      const [taken] = await tx
        .update(schema.listings)
        .set({
          stock: sql`${schema.listings.stock} - 1`,
          status: sql`case when ${schema.listings.stock} - 1 <= 0 then 'sold' else ${schema.listings.status} end`,
        })
        .where(and(eq(schema.listings.id, id), gt(schema.listings.stock, 0), inArray(schema.listings.status, ["active", "sold"])))
        .returning({ id: schema.listings.id });
      if (!taken) {
        tx.rollback();
      }
    }
    return "taken" as const;
  }).catch((err) => {
    if (String(err?.message ?? err).toLowerCase().includes("rollback")) return "sold_out" as const;
    throw err;
  });
}

/** Gives the stock back (hold voided or authorize failed). */
export async function releaseStock(orderId: string): Promise<void> {
  const ids = await listingIdsFor(orderId);
  if (ids.length === 0) return;
  await db.transaction(async (tx) => {
    const [released] = await tx
      .update(schema.orders)
      .set({ stockReserved: false })
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.stockReserved, true)))
      .returning({ id: schema.orders.id });
    if (!released) return;
    for (const id of ids) {
      await tx
        .update(schema.listings)
        .set({
          stock: sql`${schema.listings.stock} + 1`,
          status: sql`case when ${schema.listings.status} = 'sold' then 'active' else ${schema.listings.status} end`,
        })
        .where(eq(schema.listings.id, id));
    }
  });
}
