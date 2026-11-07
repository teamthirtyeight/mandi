// An order as PayPal sees it right now (Agent Toolkit get_order), for the buyer and seller.
import { NextResponse } from "next/server";
import { UUID, errorResponse } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { assertOrderAccess } from "@/lib/auth/access";
import { getOrderRow } from "@/lib/orders/service";
import { paypalOrderStatus } from "@/lib/reporting";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  try {
    await assertOrderAccess(await requireUser(), id, "either");
    const order = await getOrderRow(id);
    if (!order.paypalOrderId) return NextResponse.json({ error: "This order has no PayPal order yet" }, { status: 404 });
    return NextResponse.json(await paypalOrderStatus(order.paypalOrderId, id));
  } catch (err) {
    return errorResponse(err);
  }
}
