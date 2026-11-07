// Seller needs more time to ship: renew the PayPal hold (reauthorize).
import { NextResponse } from "next/server";
import { extendHold } from "@/lib/orders/service";
import { errorResponse, UUID } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { assertOrderAccess } from "@/lib/auth/access";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  try {
    await assertOrderAccess(await requireUser(), id, "seller");
    return NextResponse.json({ order: await extendHold(id) });
  } catch (err) {
    return errorResponse(err);
  }
}
