// Seller sends proof of shipment for a PayPal dispute: the tracking and a short
// summary of the deal from Mandix's records (agreed price, problem report, refund).
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { errorResponse } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { provideDisputeEvidence } from "@/lib/paypal/rest";
import { listDisputes } from "@/lib/paypal/toolkit";

const Body = z.object({ transactionId: z.string().min(5).max(40) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^PP-[A-Z0-9-]{5,40}$/.test(id)) return NextResponse.json({ error: "Invalid dispute id" }, { status: 400 });
  try {
    const user = await requireUser("seller");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "transactionId required" }, { status: 400 });

    // The disputed transaction is the capture; it must belong to this seller.
    const [row] = await db
      .select({ order: schema.orders, title: schema.listings.title })
      .from(schema.orders)
      .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
      .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
      .where(and(eq(schema.orders.captureId, parsed.data.transactionId), eq(schema.listings.sellerId, user.sellerId!)));
    if (!row) return NextResponse.json({ error: "No order of yours matches that transaction" }, { status: 404 });
    // The dispute must be about that transaction, not just any dispute on the shared account.
    // ponytail: checks the latest 20 disputes (one list call); fetch the dispute by id if sellers ever have more open.
    const dispute = (await listDisputes())?.find((d) => d.id === id);
    if (!dispute || dispute.transactionId !== parsed.data.transactionId) {
      return NextResponse.json({ error: "That dispute isn't about this order" }, { status: 403 });
    }
    if (!row.order.trackingNumber) return NextResponse.json({ error: "This order has no tracking to send" }, { status: 409 });

    const notes = [
      `Mandix order for "${row.title}", ${row.order.currency} ${(row.order.amountMinor / 100).toFixed(2)}, agreed by the buyer's own agent and approved by the buyer.`,
      `Shipped with ${row.order.carrier} ${row.order.trackingNumber}.`,
      row.order.problemNote ? `Buyer reported: "${row.order.problemNote}". Seller's reply: "${row.order.agentRefundMessage}".` : null,
      row.order.refundedMinor > 0 ? `Refunded so far: ${row.order.currency} ${(row.order.refundedMinor / 100).toFixed(2)}.` : null,
    ]
      .filter(Boolean)
      .join(" ");

    await provideDisputeEvidence({
      disputeId: id,
      carrierName: row.order.carrier ?? "Other",
      trackingNumber: row.order.trackingNumber,
      notes,
      orderId: row.order.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
