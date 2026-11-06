// Feeds the docked "PayPal API calls" panel. Optional ?orderId= narrows to one order.
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { UUID } from "@/lib/api/errors";
import { getUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!process.env.DATABASE_URL || !(await getUser())) return NextResponse.json({ events: [] });
  const { db, schema } = await import("@/lib/db");
  const orderId = new URL(req.url).searchParams.get("orderId");
  const query = db.select().from(schema.paypalEvents);
  const events = await (orderId && UUID.test(orderId) ? query.where(eq(schema.paypalEvents.orderId, orderId)) : query)
    .orderBy(desc(schema.paypalEvents.createdAt))
    .limit(50);
  return NextResponse.json({ events });
}
