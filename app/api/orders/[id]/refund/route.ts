// Partial or full refund of a captured order. Agent-proposed refunds above the
// seller's cap come back as NEEDS_SELLER_APPROVAL (HTTP 202) instead of refunding.
import { NextResponse } from "next/server";
import { z } from "zod";
import { refundOrder } from "@/lib/orders/service";
import { errorResponse, UUID } from "@/lib/api/errors";

const Body = z.object({
  amountMinor: z.number().int().positive(),
  requestKey: z.string().uuid(),
  approvedBy: z.enum(["seller", "agent"]),
  note: z.string().max(255).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  try {
    const result = await refundOrder(id, parsed.data);
    return NextResponse.json(result, { status: result.outcome === "REFUNDED" ? 200 : 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
