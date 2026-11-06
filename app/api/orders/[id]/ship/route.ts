// Seller posts tracking → capture the held money → attach tracking to the PayPal order.
import { NextResponse } from "next/server";
import { z } from "zod";
import { shipOrder } from "@/lib/orders/service";
import { errorResponse, UUID } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { assertOrderAccess } from "@/lib/auth/access";

const Body = z.object({
  carrier: z.string().trim().min(2).max(60),
  trackingNumber: z.string().trim().min(4).max(64),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  try {
    await assertOrderAccess(await requireUser(), id, "seller");
  } catch (err) {
    return errorResponse(err);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "carrier and trackingNumber required" }, { status: 400 });
  try {
    return NextResponse.json(await shipOrder(id, parsed.data));
  } catch (err) {
    return errorResponse(err);
  }
}
