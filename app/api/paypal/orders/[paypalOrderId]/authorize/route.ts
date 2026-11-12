// Called after the buyer approves in the PayPal popup. Authorizes the order
// (money held, not taken) and stores the authorization id.
import { NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { authorizeOrder, getOrder, shippingFrom } from "@/lib/paypal/rest";
import { requireUser } from "@/lib/auth/session";
import { assertPaypalOrderAccess } from "@/lib/auth/access";
import { errorResponse } from "@/lib/api/errors";
import { releaseStock, takeStock } from "@/lib/orders/stock";
import { notifyOrder } from "@/lib/notify";

export async function POST(_req: Request, { params }: { params: Promise<{ paypalOrderId: string }> }) {
  const { paypalOrderId } = await params;
  if (!/^[A-Z0-9]{10,30}$/.test(paypalOrderId)) {
    return NextResponse.json({ error: "Invalid PayPal order id" }, { status: 400 });
  }

  try {
    await assertPaypalOrderAccess(await requireUser(), paypalOrderId, "buyer");
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.paypalOrderId, paypalOrderId));
    if (!row) return NextResponse.json({ error: "Unknown order" }, { status: 404 });
    // A repeat of a call that already went through (double click, retry): same
    // answer, nothing done twice. PayPal replays its first response to a repeated
    // authorize, so without this check a voided order could take stock again.
    if (row.status === "AUTHORIZED") {
      return NextResponse.json({ authorizationId: row.authorizationId, status: "CREATED", orderId: row.id });
    }
    if (!["CREATED", "APPROVED"].includes(row.status)) {
      return NextResponse.json({ error: `This order is ${row.status}; approve the deal again to pay.` }, { status: 409 });
    }

    // Take the item's stock first, so two buyers can't both pay for the last piece.
    const stock = await takeStock(row.id);
    if (stock === "sold_out") {
      return NextResponse.json(
        { error: "Sorry, this item has just sold to another buyer. You have not been charged." },
        { status: 409 },
      );
    }
    let auth: Awaited<ReturnType<typeof authorizeOrder>>;
    try {
      auth = await authorizeOrder(paypalOrderId, { orderId: row.id });
    } catch (err) {
      // Only the call that took the stock gives it back.
      if (stock === "taken") await releaseStock(row.id);
      throw err;
    }
    // The authorize response normally carries the address; if not, read the order.
    const shipping = auth.shipping ?? shippingFrom(await getOrder(paypalOrderId, { orderId: row.id }).catch(() => null));

    // Only move forward: a webhook may already have recorded this authorization.
    const [moved] = await db
      .update(schema.orders)
      .set({ status: "AUTHORIZED", authorizationId: auth.authorizationId, authorizedAt: new Date(), shipping })
      .where(and(eq(schema.orders.id, row.id), inArray(schema.orders.status, ["CREATED", "APPROVED"])))
      .returning({ id: schema.orders.id });
    if (row.negotiationId) {
      await db.update(schema.negotiations).set({ state: "ORDERED" }).where(eq(schema.negotiations.id, row.negotiationId));
    }
    // A webhook recorded the hold first: it has no address, so add it here.
    if (!moved) await db.update(schema.orders).set({ shipping }).where(and(eq(schema.orders.id, row.id), isNull(schema.orders.shipping)));
    // One alert per hold: from the call that recorded it, or that took the stock.
    if (moved || stock === "taken") await notifyOrder(row.id, "held");

    return NextResponse.json({
      authorizationId: auth.authorizationId,
      status: auth.status,
      expirationTime: auth.expirationTime,
      orderId: row.id,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
