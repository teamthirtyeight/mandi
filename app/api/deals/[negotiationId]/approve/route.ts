// The buyer's one tap. Re-checks the agreed price against the mandate, then
// creates a PayPal order with intent AUTHORIZE paid to the seller. Agents have
// no route to this endpoint; only the buyer's browser calls it.
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { errorResponse, UUID } from "@/lib/api/errors";
import { createAuthorizeOrder } from "@/lib/paypal/rest";

export async function POST(_req: Request, { params }: { params: Promise<{ negotiationId: string }> }) {
  const { negotiationId } = await params;
  if (!UUID.test(negotiationId)) return NextResponse.json({ error: "Invalid deal id" }, { status: 400 });

  try {
    const [row] = await db
      .select({ n: schema.negotiations, mandate: schema.mandates, listing: schema.listings, seller: schema.sellers })
      .from(schema.negotiations)
      .innerJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
      .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
      .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
      .where(eq(schema.negotiations.id, negotiationId));
    if (!row) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const amountMinor = row.n.agreedPriceMinor;
    if (!["AGREED", "AWAITING_BUYER_APPROVAL"].includes(row.n.state) || amountMinor == null) {
      return NextResponse.json({ error: `Deal is ${row.n.state}` }, { status: 409 });
    }
    // Approval gate re-checks the guardrails before any money moves.
    if (amountMinor > row.mandate.maxPriceMinor || amountMinor < row.listing.floorPriceMinor) {
      return NextResponse.json({ error: "Agreed price is outside the limits" }, { status: 422 });
    }

    // A second tap reuses the open order instead of creating another one.
    const [existing] = await db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.negotiationId, negotiationId), inArray(schema.orders.status, ["CREATED", "APPROVED"])));
    if (existing?.paypalOrderId) return NextResponse.json({ id: existing.paypalOrderId, orderId: existing.id });

    const [order] = await db
      .insert(schema.orders)
      .values({ negotiationId, amountMinor, currency: row.listing.currency, status: "CREATED" })
      .returning();

    const paypal = await createAuthorizeOrder({
      amountMinor,
      currency: row.listing.currency,
      itemName: row.listing.title,
      description: `Mandi deal with ${row.seller.name}, ${row.seller.city}`,
      payeeEmail: row.seller.paypalMerchantEmail.endsWith("@example.com") ? undefined : row.seller.paypalMerchantEmail,
      referenceId: order.id,
      requestId: `deal-${negotiationId}-${order.id}`,
      orderId: order.id,
    });

    await db.update(schema.orders).set({ paypalOrderId: paypal.id }).where(eq(schema.orders.id, order.id));
    await db
      .update(schema.negotiations)
      .set({ state: "AWAITING_BUYER_APPROVAL" })
      .where(eq(schema.negotiations.id, negotiationId));

    return NextResponse.json({ id: paypal.id, orderId: order.id });
  } catch (err) {
    return errorResponse(err);
  }
}
