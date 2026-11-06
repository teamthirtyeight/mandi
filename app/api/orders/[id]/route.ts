import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getOrderRow } from "@/lib/orders/service";
import { errorResponse, UUID } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  try {
    const order = await getOrderRow(id);
    const events = await db
      .select()
      .from(schema.paypalEvents)
      .where(eq(schema.paypalEvents.orderId, id))
      .orderBy(desc(schema.paypalEvents.createdAt));
    return NextResponse.json({ order, events });
  } catch (err) {
    return errorResponse(err);
  }
}
