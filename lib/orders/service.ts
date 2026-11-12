// Payment service: the only code that moves money. Deterministic, no LLM.
// Each action first claims the order with a conditional UPDATE so a double
// click or a racing webhook can't run the same money call twice.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkRefund, type RefundDecision } from "@/lib/engine/negotiation";
import { releaseStock } from "./stock";
import { creditSellerDebt, debitSellerForRefund, payOutOrder } from "./payout";
import { notifyOrder } from "@/lib/notify";
import {
  addTracking,
  captureAuthorization,
  PaypalError,
  reauthorize,
  refundCapture,
  voidAuthorization,
} from "@/lib/paypal/rest";

const DEFAULT_REFUND_CAP_MINOR = 1000;

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Order = typeof schema.orders.$inferSelect;

export async function getOrderRow(orderId: string): Promise<Order> {
  const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!row) throw new OrderError("Order not found", 404);
  return row;
}

/** Seller ships: capture the held money, then attach tracking to the PayPal order. */
export async function shipOrder(orderId: string, input: { carrier: string; trackingNumber: string }) {
  const [claimed] = await db
    .update(schema.orders)
    .set({ status: "SHIPPED", carrier: input.carrier, trackingNumber: input.trackingNumber, claimedAt: new Date() })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, "AUTHORIZED")))
    .returning();
  if (!claimed) {
    const row = await getOrderRow(orderId);
    throw new OrderError(`Order is ${row.status}; only AUTHORIZED orders can ship`, 409);
  }
  if (!claimed.authorizationId || !claimed.paypalOrderId) {
    await db.update(schema.orders).set({ status: "AUTHORIZED" }).where(eq(schema.orders.id, orderId));
    throw new OrderError("Order has no PayPal authorization", 409);
  }

  let captureId: string;
  try {
    ({ captureId } = await captureAuthorization(claimed.authorizationId, { orderId }));
  } catch (err) {
    // Capture failed: put the order back so the seller can retry.
    await db.update(schema.orders).set({ status: "AUTHORIZED" }).where(eq(schema.orders.id, orderId));
    throw err;
  }

  await db
    .update(schema.orders)
    .set({ status: "CAPTURED", captureId, capturedAt: new Date() })
    .where(eq(schema.orders.id, orderId));

  // Money is captured at this point; a tracking failure is reported, not rolled back.
  // Known carriers go by PayPal's code; if PayPal rejects it, send OTHER + the name.
  let trackingWarning: string | null = null;
  const track = (carrier: string) =>
    addTracking({
      paypalOrderId: claimed.paypalOrderId!,
      captureId,
      trackingNumber: input.trackingNumber,
      carrier,
      carrierNameOther: input.carrier,
      orderId,
    });
  const code = carrierCode(input.carrier);
  try {
    await track(code);
  } catch (err) {
    if (code !== "OTHER" && err instanceof PaypalError && err.status < 500) {
      try {
        await track("OTHER");
      } catch (retryErr) {
        trackingWarning = (retryErr as Error).message;
      }
    } else {
      trackingWarning = (err as Error).message;
    }
  }

  await notifyOrder(orderId, "captured");
  // Pass the seller their share. A payout failure is recorded on the order and
  // can be retried; it never undoes the capture.
  try {
    await payOutOrder(orderId);
  } catch (err) {
    console.error("[ship] payout error", orderId, err);
  }
  return { order: await getOrderRow(orderId), trackingWarning };
}

/** Seller needs more time: renew the hold. Resets the auto-void window. */
export async function extendHold(orderId: string) {
  const order = await getOrderRow(orderId);
  if (order.status !== "AUTHORIZED" || !order.authorizationId) {
    throw new OrderError(`Order is ${order.status}; only held orders can be extended`, 409);
  }
  const renewed = await reauthorize(order.authorizationId, { orderId });
  await db
    .update(schema.orders)
    .set({ authorizationId: renewed.authorizationId, authorizedAt: new Date() })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, "AUTHORIZED")));
  return getOrderRow(orderId);
}

/** Seller can't ship: release the hold. */
export async function voidOrder(orderId: string) {
  const [claimed] = await db
    .update(schema.orders)
    .set({ status: "VOIDED" })
    .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, "AUTHORIZED")))
    .returning();
  if (!claimed) {
    const row = await getOrderRow(orderId);
    throw new OrderError(`Order is ${row.status}; only AUTHORIZED orders can be voided`, 409);
  }
  try {
    await voidAuthorization(claimed.authorizationId!, { orderId });
  } catch (err) {
    await db.update(schema.orders).set({ status: "AUTHORIZED" }).where(eq(schema.orders.id, orderId));
    throw err;
  }
  await releaseStock(orderId);
  await notifyOrder(orderId, "voided");
  return getOrderRow(orderId);
}

async function sellerRefundCap(order: Order): Promise<number> {
  if (!order.negotiationId) return DEFAULT_REFUND_CAP_MINOR;
  const [row] = await db
    .select({ listingCap: schema.listings.refundCapMinor, sellerCap: schema.sellers.refundCapMinor })
    .from(schema.negotiations)
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(eq(schema.negotiations.id, order.negotiationId));
  return row?.listingCap ?? row?.sellerCap ?? DEFAULT_REFUND_CAP_MINOR;
}

export interface RefundInput {
  amountMinor: number;
  /** Stable per refund attempt, so a retry reuses the same PayPal-Request-Id. */
  requestKey: string;
  /** "seller" = the seller tapped approve; "agent" = proposed by the seller agent. */
  approvedBy: "seller" | "agent";
  note?: string;
}

export type RefundResult =
  | { outcome: "REFUNDED"; order: Order; refundId: string }
  | { outcome: "NEEDS_SELLER_APPROVAL"; order: Order };

export async function refundOrder(orderId: string, input: RefundInput): Promise<RefundResult> {
  const order = await getOrderRow(orderId);
  if (order.status !== "CAPTURED" || !order.captureId) {
    throw new OrderError(`Order is ${order.status}; only captured orders can be refunded`, 409);
  }

  // The payout is being worked out from this order's refunds right now.
  if (order.payoutStatus === "SENDING") throw new OrderError("The seller's payout is being sent. Try again in a minute.", 409);

  const decision: RefundDecision = checkRefund({
    amountMinor: input.amountMinor,
    capturedMinor: order.amountMinor,
    alreadyRefundedMinor: order.refundedMinor,
    sellerCapMinor: input.approvedBy === "seller" ? order.amountMinor : await sellerRefundCap(order),
  });
  if (decision === "REJECTED") throw new OrderError("Refund exceeds what is left to refund", 422);
  if (decision === "NEEDS_SELLER_APPROVAL") return { outcome: "NEEDS_SELLER_APPROVAL", order };

  // Reserve the amount first so two concurrent refunds can't exceed the capture.
  const [reserved] = await db
    .update(schema.orders)
    .set({ refundedMinor: sql`${schema.orders.refundedMinor} + ${input.amountMinor}` })
    .where(
      and(
        eq(schema.orders.id, orderId),
        eq(schema.orders.status, "CAPTURED"),
        sql`${schema.orders.refundedMinor} + ${input.amountMinor} <= ${schema.orders.amountMinor}`,
        // A payout that started since the order was read has already counted the refunds.
        sql`${schema.orders.payoutStatus} is not distinct from ${order.payoutStatus}`,
      ),
    )
    .returning();
  if (!reserved) throw new OrderError("Refund exceeds what is left to refund", 409);

  const unreserve = () =>
    db
      .update(schema.orders)
      .set({ refundedMinor: sql`${schema.orders.refundedMinor} - ${input.amountMinor}` })
      .where(eq(schema.orders.id, orderId));
  // The seller already has this money: it comes off their next payout, within a limit.
  const debited = await debitSellerForRefund(order, input.amountMinor);
  if (debited === "over_limit") {
    await unreserve();
    throw new OrderError(
      "The seller has already been paid for this order, and this refund is more than Mandix can take back from their next sales. The seller can refund it from their own PayPal account, or the buyer can open a PayPal dispute.",
      409,
    );
  }
  const undebit = () => (debited === "debited" ? creditSellerDebt(order, input.amountMinor) : Promise.resolve());

  try {
    const { refundId } = await refundCapture({
      captureId: order.captureId,
      amountMinor: input.amountMinor,
      currency: order.currency,
      requestId: `refund-${input.requestKey}`,
      note: input.note,
      orderId,
    });
    // Record the refund id. If it's already there, this was a retry that PayPal
    // answered with the same refund: no new money moved, so give the amount back.
    const [counted] = await db
      .update(schema.orders)
      .set({ refundIds: sql`${schema.orders.refundIds} || ${JSON.stringify([refundId])}::jsonb` })
      .where(and(eq(schema.orders.id, orderId), sql`NOT (${schema.orders.refundIds} ? ${refundId})`))
      .returning();
    if (!counted) {
      await unreserve();
      await undebit();
      return { outcome: "REFUNDED", order: await getOrderRow(orderId), refundId };
    }
    await db
      .update(schema.orders)
      .set({ pendingRefundMinor: null, ...(counted.refundedMinor >= counted.amountMinor ? { status: "REFUNDED" as const } : {}) })
      .where(eq(schema.orders.id, orderId));
    await notifyOrder(orderId, "refunded", input.amountMinor);
    return { outcome: "REFUNDED", order: await getOrderRow(orderId), refundId };
  } catch (err) {
    await unreserve();
    await undebit();
    throw err;
  }
}

/** Seller says no to a refund their agent proposed: clear it and tell the buyer. */
export async function declineRefund(orderId: string) {
  const [cleared] = await db
    .update(schema.orders)
    .set({ pendingRefundMinor: null })
    .where(and(eq(schema.orders.id, orderId), sql`${schema.orders.pendingRefundMinor} is not null`))
    .returning();
  if (!cleared) throw new OrderError("No refund is waiting for this order", 409);
  await notifyOrder(orderId, "refund_declined");
  return cleared;
}

/** PayPal carrier codes for common carriers; anything else is sent as OTHER with its name. */
export function carrierCode(name: string): string {
  const n = name.trim().toLowerCase().replace(/[^a-z]/g, "");
  const known: Record<string, string> = {
    indiapost: "INDIA_POST",
    royalmail: "ROYAL_MAIL",
    dhl: "DHL",
    dhlexpress: "DHL",
    fedex: "FEDEX",
    ups: "UPS",
    usps: "USPS",
  };
  return known[n] ?? "OTHER";
}

