// Day 1 test: create an AUTHORIZE order for a fixed demo deal (Meera's scarf, £72).
// The amount is set on the server; the browser only sends an idempotency key.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAuthorizeOrder, PaypalError } from "@/lib/paypal/rest";

const TEST_DEAL = {
  amountMinor: 7200,
  currency: "GBP",
  itemName: "Handwoven Banarasi silk scarf, rose and gold",
  description: "Mandi test deal with Meera, Varanasi",
};

const Body = z.object({ requestKey: z.string().uuid() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "requestKey (uuid) required" }, { status: 400 });

  try {
    let orderRowId: string | null = null;
    if (process.env.DATABASE_URL) {
      const { db, schema } = await import("@/lib/db");
      const [row] = await db
        .insert(schema.orders)
        .values({ amountMinor: TEST_DEAL.amountMinor, currency: TEST_DEAL.currency, status: "CREATED" })
        .returning({ id: schema.orders.id });
      orderRowId = row.id;
    }

    const order = await createAuthorizeOrder({
      ...TEST_DEAL,
      payeeEmail: process.env.SELLER_MEERA_EMAIL || undefined,
      referenceId: orderRowId ?? "test-deal",
      requestId: `create-${parsed.data.requestKey}`,
      orderId: orderRowId,
    });

    if (orderRowId) {
      const { db, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      // A repeated click with the same requestKey gets the same PayPal order back
      // (idempotency). Keep the row that already holds it and drop the new one.
      const [existing] = await db
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(eq(schema.orders.paypalOrderId, order.id));
      if (existing) {
        await db.update(schema.paypalEvents).set({ orderId: existing.id }).where(eq(schema.paypalEvents.orderId, orderRowId));
        await db.delete(schema.orders).where(eq(schema.orders.id, orderRowId));
        orderRowId = existing.id;
      } else {
        await db.update(schema.orders).set({ paypalOrderId: order.id }).where(eq(schema.orders.id, orderRowId));
      }
    }

    return NextResponse.json({ id: order.id, orderId: orderRowId });
  } catch (err) {
    const status = err instanceof PaypalError ? err.status : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
