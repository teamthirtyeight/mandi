// A buyer's requests and orders, for "My orders".
import { NextResponse } from "next/server";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser("buyer");
    const mandates = await db
      .select({ id: schema.mandates.id, requestText: schema.mandates.requestText, status: schema.mandates.status, createdAt: schema.mandates.createdAt })
      .from(schema.mandates)
      // Drafts were never sent to an agent; they're not requests yet.
      .where(and(eq(schema.mandates.buyerUserId, user.id), ne(schema.mandates.status, "draft")))
      .orderBy(desc(schema.mandates.createdAt))
      .limit(20);
    const orders = await db
      .select({
        id: schema.orders.id,
        mandateId: schema.mandates.id,
        status: schema.orders.status,
        amountMinor: schema.orders.amountMinor,
        refundedMinor: schema.orders.refundedMinor,
        title: schema.listings.title,
        seller: schema.sellers.name,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
      .innerJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
      .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
      .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
      // CREATED/APPROVED orders are unpaid PayPal drafts (popup closed or never approved).
      .where(
        and(
          eq(schema.mandates.buyerUserId, user.id),
          inArray(schema.orders.status, ["AUTHORIZED", "SHIPPED", "CAPTURED", "REFUNDED", "VOIDED"]),
        ),
      )
      .orderBy(desc(schema.orders.createdAt))
      .limit(20);
    return NextResponse.json({ mandates, orders });
  } catch (err) {
    return errorResponse(err);
  }
}
