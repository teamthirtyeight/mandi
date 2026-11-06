import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getOrderRow } from "@/lib/orders/service";
import { errorResponse, UUID } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { assertOrderAccess } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  try {
    const user = await requireUser();
    await assertOrderAccess(user, id, "either");
    const order = await getOrderRow(id);
    const events = await db
      .select()
      .from(schema.paypalEvents)
      .where(eq(schema.paypalEvents.orderId, id))
      .orderBy(desc(schema.paypalEvents.createdAt));
    // Which side is looking, so the page shows the right actions.
    const viewer = order.negotiationId ? user.role : "both";
    return NextResponse.json({ order, events, viewer });
  } catch (err) {
    return errorResponse(err);
  }
}
