// One-of-a-kind stock against Postgres. Needs TEST_DATABASE_URL.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("stock reservation", () => {
  let dbmod: typeof import("@/lib/db");
  let stock: typeof import("@/lib/orders/stock");
  let listingId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    dbmod = await import("@/lib/db");
    stock = await import("@/lib/orders/stock");
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    const { db, schema } = dbmod;
    await db.execute(sql`TRUNCATE paypal_events, orders, negotiation_turns, negotiations, mandates, listings, users, sellers CASCADE`);
    const [seller] = await db
      .insert(schema.sellers)
      .values({ name: "Meera", city: "Varanasi", country: "IN", story: "Weaver.", paypalMerchantEmail: "m@example.com" })
      .returning();
    const [listing] = await db
      .insert(schema.listings)
      .values({ sellerId: seller.id, title: "Scarf", description: "One of a kind.", category: "scarf", materials: "silk", listPriceMinor: 9500, floorPriceMinor: 6800, stock: 1 })
      .returning();
    listingId = listing.id;
  });

  async function orderFor() {
    const { db, schema } = dbmod;
    const [m] = await db
      .insert(schema.mandates)
      .values({ buyerName: "Sarah", requestText: "scarf", query: "scarf", maxPriceMinor: 9000, deadline: "2026-12-20", shipToCountry: "GB" })
      .returning();
    const [n] = await db.insert(schema.negotiations).values({ mandateId: m.id, listingId, state: "AGREED", agreedPriceMinor: 8000 }).returning();
    const [o] = await db.insert(schema.orders).values({ negotiationId: n.id, amountMinor: 8000, status: "CREATED" }).returning();
    return o;
  }

  const listing = async () => {
    const { eq } = await import("drizzle-orm");
    const [l] = await dbmod.db.select().from(dbmod.schema.listings).where(eq(dbmod.schema.listings.id, listingId));
    return l;
  };

  it("the second buyer can't take the last piece, and the listing is marked sold", async () => {
    const a = await orderFor();
    const b = await orderFor();
    expect(await stock.reserveStock(a.id)).toBe(true);
    expect(await stock.reserveStock(b.id)).toBe(false);
    const l = await listing();
    expect(l.stock).toBe(0);
    expect(l.status).toBe("sold");
  });

  it("reserving twice for the same order takes stock once", async () => {
    const a = await orderFor();
    expect(await stock.reserveStock(a.id)).toBe(true);
    expect(await stock.reserveStock(a.id)).toBe(true);
    expect((await listing()).stock).toBe(0);
  });

  it("a voided hold gives the piece back", async () => {
    const a = await orderFor();
    await stock.reserveStock(a.id);
    await stock.releaseStock(a.id);
    await stock.releaseStock(a.id); // idempotent
    const l = await listing();
    expect(l.stock).toBe(1);
    expect(l.status).toBe("active");
  });

  it("notifies the seller in Hindi and the buyer in English when money is held", async () => {
    const { notifyOrder } = await import("@/lib/notify");
    const { eq } = await import("drizzle-orm");
    const { db, schema } = dbmod;
    const [listingRow] = await db.select().from(schema.listings).where(eq(schema.listings.id, listingId));
    await db.update(schema.sellers).set({ language: "hi" }).where(eq(schema.sellers.id, listingRow.sellerId));
    const [sellerUser] = await db
      .insert(schema.users)
      .values({ email: "meera@test.local", passwordHash: "x", role: "seller", name: "Meera", sellerId: listingRow.sellerId })
      .returning();
    const [buyerUser] = await db.insert(schema.users).values({ email: "sarah@test.local", passwordHash: "x", role: "buyer", name: "Sarah" }).returning();
    const o = await orderFor();
    const [n] = await db.select().from(schema.negotiations).where(eq(schema.negotiations.id, o.negotiationId!));
    await db.update(schema.mandates).set({ buyerUserId: buyerUser.id }).where(eq(schema.mandates.id, n.mandateId));

    await notifyOrder(o.id, "held");
    const rows = await db.select().from(schema.notifications);
    const seller = rows.find((r) => r.userId === sellerUser.id)!;
    const buyer = rows.find((r) => r.userId === buyerUser.id)!;
    expect(seller.title).toContain("बिक गया");
    expect(seller.title).toContain("₹");
    expect(buyer.title).toBe("£80.00 held");
  });
});

