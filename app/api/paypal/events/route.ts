// Feeds the "PayPal API calls" panel. Each user sees calls for their own
// orders only: a seller for orders on their listings, a buyer for orders from
// their requests, plus /paypal-test orders. Calls with no order (OAuth, catalog
// products) are shown to sellers only. Optional ?orderId= narrows to one order.
import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { UUID } from "@/lib/api/errors";
import { getUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ events: [] });

  const owned = db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .leftJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .leftJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .leftJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
    .where(
      or(
        and(isNull(schema.orders.negotiationId), eq(schema.orders.testUserId, user.id)),
        user.role === "seller" ? eq(schema.listings.sellerId, user.sellerId!) : eq(schema.mandates.buyerUserId, user.id),
      ),
    );

  const orderId = new URL(req.url).searchParams.get("orderId");
  // Calls with no order (OAuth tokens, catalog products) are seller-side plumbing.
  const scope =
    user.role === "seller"
      ? or(isNull(schema.paypalEvents.orderId), inArray(schema.paypalEvents.orderId, owned))
      : inArray(schema.paypalEvents.orderId, owned);
  const where = orderId && UUID.test(orderId) ? and(eq(schema.paypalEvents.orderId, orderId), scope) : scope;

  const events = await db
    .select()
    .from(schema.paypalEvents)
    .where(where ?? sql`false`)
    .orderBy(desc(schema.paypalEvents.createdAt))
    .limit(50);
  return NextResponse.json({ events });
}
