// Payment service: the only code that moves money. Deterministic, no LLM.
// Each action first claims the order with a conditional UPDATE so a double
// click or a racing webhook can't run the same money call twice.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkRefund, type RefundDecision } from "@/lib/engine/negotiation";
import {
  addTracking,
  captureAuthorization,
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
    .set({ status: "SHIPPED", carrier: input.carrier, trackingNumber: input.trackingNumber })
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
  let trackingWarning: string | null = null;
  try {
    await addTracking({
      paypalOrderId: claimed.paypalOrderId,
      captureId,
      trackingNumber: input.trackingNumber,
      carrier: "OTHER",
      carrierNameOther: input.carrier,
      orderId,
    });
  } catch (err) {
    trackingWarning = (err as Error).message;
  }

  return { order: await getOrderRow(orderId), trackingWarning };
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
      ),
    )
    .returning();
  if (!reserved) throw new OrderError("Refund exceeds what is left to refund", 409);

  try {
    const { refundId } = await refundCapture({
      captureId: order.captureId,
      amountMinor: input.amountMinor,
      currency: order.currency,
      requestId: `refund-${input.requestKey}`,
      note: input.note,
      orderId,
    });
    await db
      .update(schema.orders)
      .set({ pendingRefundMinor: null, ...(reserved.refundedMinor >= reserved.amountMinor ? { status: "REFUNDED" as const } : {}) })
      .where(eq(schema.orders.id, orderId));
    return { outcome: "REFUNDED", order: await getOrderRow(orderId), refundId };
  } catch (err) {
    await db
      .update(schema.orders)
      .set({ refundedMinor: sql`${schema.orders.refundedMinor} - ${input.amountMinor}` })
      .where(eq(schema.orders.id, orderId));
    throw err;
  }
}
