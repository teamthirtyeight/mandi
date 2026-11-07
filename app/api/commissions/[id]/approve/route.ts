// The artisan answers a custom-order request from the dashboard (the same as replying on WhatsApp).
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { UUID, errorResponse } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { approveCommission } from "@/lib/commissions";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const user = await requireUser("seller");
    const [c] = await db.select({ sellerId: schema.commissions.sellerId }).from(schema.commissions).where(eq(schema.commissions.id, id));
    if (!c || c.sellerId !== user.sellerId) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    const done = await approveCommission(id);
    return NextResponse.json({ id: done.id, status: done.status, invoiceUrl: done.invoiceUrl ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
