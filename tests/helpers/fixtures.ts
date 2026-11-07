// Shared test data: one seller with a login, a listing, a buyer, and an order.
import type * as DbModule from "@/lib/db";

type Db = typeof DbModule;

export async function sellerWithOrder(
  dbmod: Db,
  opts: {
    seller?: Partial<typeof DbModule.schema.sellers.$inferInsert>;
    order?: Partial<typeof DbModule.schema.orders.$inferInsert>;
  } = {},
) {
  const { db, schema } = dbmod;
  const [seller] = await db
    .insert(schema.sellers)
    .values({ name: "Kavya", city: "Kanchipuram", country: "IN", story: "Silk weaver.", paypalMerchantEmail: "kavya@example.com", ...opts.seller })
    .returning();
  const [sellerUser] = await db
    .insert(schema.users)
    .values({ email: `k${Math.random()}@test.local`, passwordHash: "x", role: "seller", name: seller.name, sellerId: seller.id })
    .returning();
  const [buyer] = await db
    .insert(schema.users)
    .values({ email: `b${Math.random()}@test.local`, passwordHash: "x", role: "buyer", name: "Sarah" })
    .returning();
  const [listing] = await db
    .insert(schema.listings)
    .values({ sellerId: seller.id, title: "Kanjivaram silk saree", description: "Handwoven.", category: "saree", materials: "silk", listPriceMinor: 20000, floorPriceMinor: 15000 })
    .returning();
  const [mandate] = await db
    .insert(schema.mandates)
    .values({ buyerName: "Sarah", buyerUserId: buyer.id, requestText: "saree", query: "saree", maxPriceMinor: 20000, deadline: "2026-12-20", shipToCountry: "GB" })
    .returning();
  const [negotiation] = await db
    .insert(schema.negotiations)
    .values({ mandateId: mandate.id, listingId: listing.id, state: "ORDERED", agreedPriceMinor: 18000 })
    .returning();
  const [order] = await db
    .insert(schema.orders)
    .values({
      negotiationId: negotiation.id,
      amountMinor: 18000,
      status: "AUTHORIZED",
      paypalOrderId: `ORDER${Math.floor(Math.random() * 1e12)}`,
      authorizationId: "AUTH-1",
      authorizedAt: new Date(),
      ...opts.order,
    })
    .returning();
  return { seller, sellerUser, buyer, listing, mandate, negotiation, order };
}

export const TRUNCATE_ALL =
  "TRUNCATE jobs, arena_attempts, commissions, subscriptions, app_settings, whatsapp_messages, notifications, paypal_events, orders, negotiation_turns, negotiations, mandates, listings, users, sellers CASCADE";
