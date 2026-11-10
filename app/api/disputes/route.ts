// PayPal disputes for the merchant (Agent Toolkit list_disputes), for the dashboard.
// The PayPal account is shared by every seller, so only disputes on this
// seller's own captures are returned.
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listDisputes } from "@/lib/paypal/toolkit";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser("seller");
    const disputes = await listDisputes();
    if (disputes === null) return NextResponse.json({ available: false, disputes: [] });

    // The disputed transaction is the capture: keep the ones that are this seller's orders.
    const txIds = disputes.map((d) => d.transactionId).filter((t): t is string => Boolean(t));
    const mine = txIds.length
      ? await db
          .select({ captureId: schema.orders.captureId })
          .from(schema.orders)
          .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
          .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
          .where(and(inArray(schema.orders.captureId, txIds), eq(schema.listings.sellerId, user.sellerId!)))
      : [];
    const own = new Set(mine.map((r) => r.captureId));
    return NextResponse.json({ available: true, disputes: disputes.filter((d) => d.transactionId && own.has(d.transactionId)) });
  } catch (err) {
    return errorResponse(err);
  }
}
