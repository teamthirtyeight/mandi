// Called after the buyer approves in the PayPal popup. Authorizes the order
// (money held, not taken) and stores the authorization id.
import { NextResponse } from "next/server";
import { authorizeOrder, PaypalError } from "@/lib/paypal/rest";

export async function POST(_req: Request, { params }: { params: Promise<{ paypalOrderId: string }> }) {
  const { paypalOrderId } = await params;
  if (!/^[A-Z0-9]{10,30}$/.test(paypalOrderId)) {
    return NextResponse.json({ error: "Invalid PayPal order id" }, { status: 400 });
  }

  try {
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

    const auth = await authorizeOrder(paypalOrderId, { orderId: orderRowId });

    if (orderRowId) {
      const { db, schema } = await import("@/lib/db");
      const { and, eq, inArray } = await import("drizzle-orm");
      // Only move forward: a webhook may already have recorded this authorization.
      await db
        .update(schema.orders)
        .set({ status: "AUTHORIZED", authorizationId: auth.authorizationId, authorizedAt: new Date() })
        .where(and(eq(schema.orders.id, orderRowId), inArray(schema.orders.status, ["CREATED", "APPROVED"])));
    }

    return NextResponse.json({
      authorizationId: auth.authorizationId,
      status: auth.status,
      expirationTime: auth.expirationTime,
      orderId: orderRowId,
    });
  } catch (err) {
    const status = err instanceof PaypalError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
