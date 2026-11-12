// Ownership checks. A buyer may act on their own mandates and the orders from
// them; a seller on orders and negotiations for their own listings. Orders not
// tied to a negotiation (the /paypal-test page) belong to the user who made them.
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { AuthError, type SessionUser } from "./session";

export type Party = "buyer" | "seller" | "either";

function allowed(user: SessionUser, party: Party, buyerUserId: string | null, sellerId: string | null): boolean {
  const isBuyer = user.role === "buyer" && buyerUserId === user.id;
  const isSeller = user.role === "seller" && sellerId != null && sellerId === user.sellerId;
  return party === "buyer" ? isBuyer : party === "seller" ? isSeller : isBuyer || isSeller;
}

export async function assertMandateOwner(user: SessionUser, mandateId: string) {
  const [m] = await db.select({ buyerUserId: schema.mandates.buyerUserId }).from(schema.mandates).where(eq(schema.mandates.id, mandateId));
  if (!m) throw new AuthError("Not found", 403);
  if (user.role !== "buyer" || m.buyerUserId !== user.id) throw new AuthError("That isn't your request", 403);
}

export async function assertNegotiationAccess(user: SessionUser, negotiationId: string, party: Party) {
  const [row] = await db
    .select({ buyerUserId: schema.mandates.buyerUserId, sellerId: schema.listings.sellerId })
    .from(schema.negotiations)
    .innerJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .where(eq(schema.negotiations.id, negotiationId));
  if (!row || !allowed(user, party, row.buyerUserId, row.sellerId)) throw new AuthError("Not allowed", 403);
}

async function orderParties(where: ReturnType<typeof eq>) {
  const [row] = await db
    .select({
      negotiationId: schema.orders.negotiationId,
      testUserId: schema.orders.testUserId,
      buyerUserId: schema.mandates.buyerUserId,
      sellerId: schema.listings.sellerId,
    })
    .from(schema.orders)
    .leftJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .leftJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
    .leftJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .where(where);
  return row;
}

function check(user: SessionUser, party: Party, row: Awaited<ReturnType<typeof orderParties>>) {
  if (!row) throw new AuthError("Not found", 403);
  if (!row.negotiationId) {
    // Test orders from /paypal-test: their maker plays both sides.
    if (row.testUserId !== user.id) throw new AuthError("Not allowed", 403);
    return;
  }
  if (!allowed(user, party, row.buyerUserId, row.sellerId)) throw new AuthError("Not allowed", 403);
}

export async function assertOrderAccess(user: SessionUser, orderId: string, party: Party) {
  check(user, party, await orderParties(eq(schema.orders.id, orderId)));
}

export async function assertPaypalOrderAccess(user: SessionUser, paypalOrderId: string, party: Party) {
  check(user, party, await orderParties(eq(schema.orders.paypalOrderId, paypalOrderId)));
}
