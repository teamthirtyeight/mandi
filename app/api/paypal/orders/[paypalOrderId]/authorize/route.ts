// Called after the buyer approves in the PayPal popup. Authorizes the order
// (money held, not taken) and stores the authorization id.
import { NextResponse } from "next/server";
import { authorizeOrder, getOrder, PaypalError, shippingFrom } from "@/lib/paypal/rest";
import { AuthError, requireUser } from "@/lib/auth/session";
import { assertPaypalOrderAccess } from "@/lib/auth/access";
import { releaseStock, reserveStock } from "@/lib/orders/stock";
import { notifyOrder } from "@/lib/notify";

export async function POST(_req: Request, { params }: { params: Promise<{ paypalOrderId: string }> }) {
  const { paypalOrderId } = await params;
  if (!/^[A-Z0-9]{10,30}$/.test(paypalOrderId)) {
    return NextResponse.json({ error: "Invalid PayPal order id" }, { status: 400 });
  }

  try {
    await assertPaypalOrderAccess(await requireUser(), paypalOrderId, "buyer");
    let orderRowId: string | null = null;
    if (process.env.DATABASE_URL) {
      const { db, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const [row] = await db
        .select({ id: schema.orders.id, status: schema.orders.status })
        .from(schema.orders)
        .where(eq(schema.orders.paypalOrderId, paypalOrderId));
      if (!row) return NextResponse.json({ error: "Unknown order" }, { status: 404 });
      orderRowId = row.id;
    }

    // Take the item's stock first, so two buyers can't both pay for the last piece.
    if (orderRowId && !(await reserveStock(orderRowId))) {
      return NextResponse.json(
        { error: "Sorry, this item has just sold to another buyer. You have not been charged." },
        { status: 409 },
      );
    }
    let auth: Awaited<ReturnType<typeof authorizeOrder>>;
    try {
      auth = await authorizeOrder(paypalOrderId, { orderId: orderRowId });
    } catch (err) {
      if (orderRowId) await releaseStock(orderRowId);
      throw err;
    }
    // The authorize response normally carries the address; if not, read the order.
    const shipping = auth.shipping ?? shippingFrom(await getOrder(paypalOrderId, { orderId: orderRowId }).catch(() => null));

    if (orderRowId) {
      const { db, schema } = await import("@/lib/db");
      const { and, eq, inArray } = await import("drizzle-orm");
      // Only move forward: a webhook may already have recorded this authorization.
      await db
        .update(schema.orders)
        .set({ status: "AUTHORIZED", authorizationId: auth.authorizationId, authorizedAt: new Date(), shipping })
        .where(and(eq(schema.orders.id, orderRowId), inArray(schema.orders.status, ["CREATED", "APPROVED"])));
      const [order] = await db
        .select({ negotiationId: schema.orders.negotiationId })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderRowId));
      if (order?.negotiationId) {
        await db
          .update(schema.negotiations)
          .set({ state: "ORDERED" })
          .where(eq(schema.negotiations.id, order.negotiationId));
      }
    }

    if (orderRowId) await notifyOrder(orderRowId, "held");
    return NextResponse.json({
      authorizationId: auth.authorizationId,
      status: auth.status,
      expirationTime: auth.expirationTime,
      orderId: orderRowId,
    });
  } catch (err) {
    const status = err instanceof PaypalError || err instanceof AuthError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
