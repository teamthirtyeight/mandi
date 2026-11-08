// Seller payouts. When Mandix is the payee (the default), the buyer's money is
// captured into Mandix's PayPal account; after capture this sends the seller
// their share through PayPal Payouts, minus Mandix's fee and minus any refunds
// made after an earlier payout. Deterministic code only: no agent can call it.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createPayout, getPayout, PaypalError } from "@/lib/paypal/rest";
import { notifyOrder } from "@/lib/notify";

export { feePct, payoutSplit } from "./payout-split";
import { feePct, payoutReceiver, payoutSplit } from "./payout-split";

const FINAL = new Set(["SUCCESS", "FAILED", "RETURNED", "REFUNDED", "REVERSED", "BLOCKED", "DENIED", "CANCELED", "UNCLAIMED"]);

/**
 * Pays the seller for a captured order, once. Safe to call again: the order is
 * claimed with a conditional update, and PayPal rejects a repeated batch id.
 */
export async function payOutOrder(orderId: string): Promise<typeof schema.orders.$inferSelect | null> {
  const [claimed] = await db
    .update(schema.orders)
    .set({ payoutStatus: "SENDING" })
    .where(
      and(
        eq(schema.orders.id, orderId),
        eq(schema.orders.status, "CAPTURED"),
        isNull(schema.orders.payoutStatus),
        // Paid straight to the seller already: nothing to pass on.
        isNull(schema.orders.payeeEmail),
      ),
    )
    .returning();
  if (!claimed || !claimed.negotiationId) return null;

  const [row] = await db
    .select({ seller: schema.sellers, title: schema.listings.title })
    .from(schema.negotiations)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(eq(schema.negotiations.id, claimed.negotiationId));
  if (!row) {
    await db.update(schema.orders).set({ payoutStatus: null }).where(eq(schema.orders.id, orderId));
    return null;
  }

  const split = payoutSplit({
    capturedMinor: claimed.amountMinor,
    refundedMinor: claimed.refundedMinor,
    debtMinor: row.seller.payoutDebtMinor,
    feePct: feePct(),
  });
  // Take the debt first, so a concurrent payout for another order can't use it twice.
  if (split.debtUsedMinor > 0) {
    await db
      .update(schema.sellers)
      .set({ payoutDebtMinor: sql`greatest(0, ${schema.sellers.payoutDebtMinor} - ${split.debtUsedMinor})` })
      .where(eq(schema.sellers.id, row.seller.id));
  }
  if (split.payoutMinor <= 0) {
    await db
      .update(schema.orders)
      .set({ payoutStatus: "SUCCESS", payoutMinor: 0, feeMinor: split.feeMinor, paidOutAt: new Date() })
      .where(eq(schema.orders.id, orderId));
    return getOrder(orderId);
  }

  try {
    const sent = await createPayout({
      senderBatchId: `mandi-order-${orderId}`,
      ...payoutReceiver(row.seller),
      amountMinor: split.payoutMinor,
      currency: claimed.currency,
      subject: `Mandix: payment for ${row.title}`,
      note: `Your share of ${row.title}, after Mandix's ${feePct()}% fee. Thank you for your craft.`,
      orderId,
    });
    await db
      .update(schema.orders)
      .set({
        payoutStatus: sent.status,
        payoutBatchId: sent.batchId,
        payoutMinor: split.payoutMinor,
        feeMinor: split.feeMinor,
        paidOutAt: new Date(),
        payoutError: null,
      })
      .where(eq(schema.orders.id, orderId));
    await notifyOrder(orderId, "paid_out", split.payoutMinor);
  } catch (err) {
    // Give the debt back and record why, so the seller (and Mandix) can see it and retry.
    if (split.debtUsedMinor > 0) {
      await db
        .update(schema.sellers)
        .set({ payoutDebtMinor: sql`${schema.sellers.payoutDebtMinor} + ${split.debtUsedMinor}` })
        .where(eq(schema.sellers.id, row.seller.id));
    }
    const message = err instanceof PaypalError ? err.message : (err as Error).message;
    await db
      .update(schema.orders)
      .set({ payoutStatus: "FAILED", payoutMinor: split.payoutMinor, feeMinor: split.feeMinor, payoutError: message.slice(0, 500) })
      .where(eq(schema.orders.id, orderId));
    console.error("[payout] failed", orderId, message);
  }
  return getOrder(orderId);
}

/** A failed payout can be sent again (same batch id, so never twice). */
export async function retryPayout(orderId: string) {
  const [reset] = await db
    .update(schema.orders)
    .set({ payoutStatus: null })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.payoutStatus, "FAILED")))
    .returning();
  return reset ? payOutOrder(orderId) : getOrder(orderId);
}

/** Retries every failed payout for one seller (after they fix their PayPal email). Returns how many were retried. */
export async function retryFailedPayouts(sellerId: string): Promise<number> {
  const failed = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .where(and(eq(schema.listings.sellerId, sellerId), eq(schema.orders.payoutStatus, "FAILED")));
  for (const o of failed) await retryPayout(o.id).catch((err) => console.error("[payout] retry failed", o.id, err));
  return failed.length;
}

/** Refreshes payouts PayPal is still processing, for the given orders. */
export async function refreshPayouts(orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return;
  const open = await db
    .select({ id: schema.orders.id, batchId: schema.orders.payoutBatchId, status: schema.orders.payoutStatus })
    .from(schema.orders)
    .where(inArray(schema.orders.id, orderIds));
  for (const o of open.filter((o) => o.batchId && o.status && !FINAL.has(o.status)).slice(0, 5)) {
    try {
      const now = await getPayout(o.batchId!, { orderId: o.id });
      if (now.status && now.status !== o.status) {
        await db.update(schema.orders).set({ payoutStatus: now.status, payoutError: now.error }).where(eq(schema.orders.id, o.id));
      }
    } catch (err) {
      console.error("[payout] refresh failed", o.id, (err as Error).message);
    }
  }
}

/** A refund after the seller was paid comes off their next payout. */
export async function recordRefundAfterPayout(order: typeof schema.orders.$inferSelect, amountMinor: number) {
  if (!order.payoutStatus || order.payoutStatus === "FAILED" || order.payoutStatus === "SENDING" || !order.negotiationId) return;
  const [row] = await db
    .select({ sellerId: schema.listings.sellerId })
    .from(schema.negotiations)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .where(eq(schema.negotiations.id, order.negotiationId));
  if (!row) return;
  await db
    .update(schema.sellers)
    .set({ payoutDebtMinor: sql`${schema.sellers.payoutDebtMinor} + ${amountMinor}` })
    .where(eq(schema.sellers.id, row.sellerId));
}

async function getOrder(orderId: string) {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  return o ?? null;
}
