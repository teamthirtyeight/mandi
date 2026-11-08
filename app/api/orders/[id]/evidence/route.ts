// Dispute evidence pack for one order: the listing, the mandate, the full
// negotiation log with every engine decision, PayPal ids, tracking, and the
// buyer's problem report and photo. Downloads as JSON for the seller to submit.
import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { errorResponse, UUID } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { assertOrderAccess } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });

  try {
    await assertOrderAccess(await requireUser(), id, "either");
  } catch (err) {
    return errorResponse(err);
  }
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  let deal = null;
  if (order.negotiationId) {
    const [row] = await db
      .select({ n: schema.negotiations, mandate: schema.mandates, listing: schema.listings, seller: schema.sellers })
      .from(schema.negotiations)
      .innerJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
      .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
      .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
      .where(eq(schema.negotiations.id, order.negotiationId));
    const turns = await db
      .select()
      .from(schema.negotiationTurns)
      .where(eq(schema.negotiationTurns.negotiationId, order.negotiationId))
      .orderBy(asc(schema.negotiationTurns.createdAt));
    if (row) {
      deal = {
        seller: { name: row.seller.name, city: row.seller.city, country: row.seller.country },
        listing: {
          title: row.listing.title,
          description: row.listing.description,
          materials: row.listing.materials,
          listPrice: row.listing.listPriceMinor / 100,
          paypalProductId: row.listing.paypalProductId,
          images: row.listing.images.length,
        },
        buyerRequest: { text: row.mandate.requestText, budget: row.mandate.maxPriceMinor / 100, deadline: row.mandate.deadline },
        agreedPrice: row.n.agreedPriceMinor != null ? row.n.agreedPriceMinor / 100 : null,
        chatLog: turns.map((t) => ({
          at: t.createdAt.toISOString(),
          from: t.actor,
          round: t.round,
          message: t.message,
          proposedPrice: t.proposedPriceMinor != null ? t.proposedPriceMinor / 100 : null,
          allowedPrice: t.finalPriceMinor != null ? t.finalPriceMinor / 100 : null,
          engineDecision: t.guardrailResult,
        })),
      };
    }
  }

  const events = await db
    .select()
    .from(schema.paypalEvents)
    .where(eq(schema.paypalEvents.orderId, id))
    .orderBy(asc(schema.paypalEvents.createdAt));

  const pack = {
    generatedAt: new Date().toISOString(),
    order: {
      id: order.id,
      paypalOrderId: order.paypalOrderId,
      authorizationId: order.authorizationId,
      captureId: order.captureId,
      amount: `${order.currency} ${(order.amountMinor / 100).toFixed(2)}`,
      refunded: `${order.currency} ${(order.refundedMinor / 100).toFixed(2)}`,
      status: order.status,
      authorizedAt: order.authorizedAt,
      capturedAt: order.capturedAt,
    },
    shipping: { carrier: order.carrier, trackingNumber: order.trackingNumber, address: order.shipping },
    problemReport: order.problemNote
      ? { description: order.problemNote, sellerAgentReply: order.agentRefundMessage, photo: order.problemPhoto }
      : null,
    deal,
    paypalCalls: events.map((e) => ({ at: e.createdAt.toISOString(), call: `${e.method ?? e.direction} ${e.endpoint}`, status: e.httpStatus, summary: e.summary })),
  };

  return new NextResponse(JSON.stringify(pack, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="mandix-evidence-${order.paypalOrderId ?? order.id}.json"`,
    },
  });
}
