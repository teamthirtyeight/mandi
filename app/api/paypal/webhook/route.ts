// PayPal webhook listener. Verifies the signature with PayPal, logs the event
// for the call panel, and moves the order forward only (see lib/orders/state).
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { advance, statusForWebhook, type OrderStatus } from "@/lib/orders/state";
import { verifyWebhookSignature } from "@/lib/paypal/rest";
import { logPaypalEvent } from "@/lib/paypal/log";

export async function POST(req: Request) {
  const raw = await req.text();
  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers, raw);
  } catch (err) {
    console.error("[webhook] verification error", err);
  }
  if (!verified) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  const event = JSON.parse(raw);
  const resource = event.resource ?? {};
  // Authorization/capture resources point back to the order in supplementary_data.
  const paypalOrderId: string | undefined =
    resource.supplementary_data?.related_ids?.order_id ?? (event.resource_type === "checkout-order" ? resource.id : undefined);

  let orderRow: typeof schema.orders.$inferSelect | undefined;
  if (paypalOrderId) {
    [orderRow] = await db.select().from(schema.orders).where(eq(schema.orders.paypalOrderId, paypalOrderId));
  }

  await logPaypalEvent({
    direction: "webhook",
    endpoint: event.event_type,
    httpStatus: 200,
    orderId: orderRow?.id ?? null,
    summary: event.summary ?? event.event_type,
  });

  const implied = statusForWebhook(event.event_type);
  if (orderRow && implied) {
    const next = advance(orderRow.status as OrderStatus, implied);
    if (next !== orderRow.status) {
      const patch: Partial<typeof schema.orders.$inferInsert> = { status: next };
      if (implied === "AUTHORIZED" && !orderRow.authorizationId) {
        patch.authorizationId = resource.id;
        patch.authorizedAt = new Date();
      }
      if (implied === "CAPTURED" && !orderRow.captureId) {
        patch.captureId = resource.id;
        patch.capturedAt = new Date();
      }
      await db.update(schema.orders).set(patch).where(eq(schema.orders.id, orderRow.id));
    }
  }

  return NextResponse.json({ received: true });
}
