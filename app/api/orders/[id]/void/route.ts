// Seller can't ship: void the authorization and release the buyer's hold.
import { NextResponse } from "next/server";
import { voidOrder } from "@/lib/orders/service";
import { errorResponse, UUID } from "@/lib/api/errors";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  try {
    return NextResponse.json({ order: await voidOrder(id) });
  } catch (err) {
    return errorResponse(err);
  }
}
