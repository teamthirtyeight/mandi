// PayPal webhook listener. Verifies the signature with PayPal, logs the event
// for the call panel, and moves the order forward only (see lib/orders/state).
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { advance, statusForWebhook, type OrderStatus } from "@/lib/orders/state";
import { verifyWebhookSignature } from "@/lib/paypal/rest";
import { logPaypalEvent } from "@/lib/paypal/log";
import { releaseStock } from "@/lib/orders/stock";
import { markCommissionPaid } from "@/lib/commissions";
import { monthlyPaymentReceived, refreshSubscription } from "@/lib/subscriptions";

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
      if (next === "VOIDED") await releaseStock(orderRow.id);
    }
  }

  // Invoices, subscriptions and payouts (not tied to a checkout order).
  try {
    await handleOtherEvents(event.event_type as string, resource);
  } catch (err) {
    console.error("[webhook] follow-up failed", event.event_type, err);
  }

  return NextResponse.json({ received: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleOtherEvents(type: string, resource: any) {
  if (type === "INVOICING.INVOICE.PAID") {
    const invoiceId: string | undefined = resource.id ?? resource.invoice?.id;
    if (!invoiceId) return;
    const [c] = await db.select({ id: schema.commissions.id }).from(schema.commissions).where(eq(schema.commissions.invoiceId, invoiceId));
    if (c) await markCommissionPaid(c.id);
    return;
  }
  if (type.startsWith("BILLING.SUBSCRIPTION.") && resource.id) {
    await refreshSubscription(resource.id);
    return;
  }
  if (type === "PAYMENT.SALE.COMPLETED" && resource.billing_agreement_id) {
    await monthlyPaymentReceived({
      saleId: resource.id,
      subscriptionId: resource.billing_agreement_id,
      amount: resource.amount?.total ?? "0",
      currency: resource.amount?.currency ?? "USD",
    });
    return;
  }
  if (type.startsWith("PAYMENT.PAYOUTS-ITEM.") || type.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    // Payout status changes: refresh the order whose batch this is.
    const batchId: string | undefined = resource.payout_batch_id ?? resource.batch_header?.payout_batch_id;
    if (!batchId) return;
    const [o] = await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.payoutBatchId, batchId));
    if (o) {
      const { refreshPayouts } = await import("@/lib/orders/payout");
      await refreshPayouts([o.id]);
    }
  }
}
