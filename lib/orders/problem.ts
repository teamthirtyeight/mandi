// Buyer reports a problem → seller agent proposes a refund → the order
// service refunds it if it is within the seller's cap, or parks it for the
// seller's tap if it is above. The agent never calls PayPal itself.
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { proposeRefund } from "@/lib/agents/refund";
import type { PhotoInput } from "@/lib/agents/listing";
import { getOrderRow, OrderError, refundOrder } from "./service";
import { notifyOrder } from "@/lib/notify";
import { evaluateRefund, type OrderRecord } from "@/lib/guardrails";

/** One automatic refund per order; any further refund waits for the seller. */
const MAX_AUTO_REFUNDS = 1;

const DEFAULT_CAP_MINOR = 1000;

export async function reportProblem(
  orderId: string,
  input: { description: string; photo: PhotoInput | null; requestKey: string },
) {
  const order = await getOrderRow(orderId);
  if (order.status !== "CAPTURED") throw new OrderError(`Order is ${order.status}; problems can be reported after delivery`, 409);
  if (order.pendingRefundMinor != null) throw new OrderError("A refund is already waiting for the seller", 409);
  const refundableMinor = order.amountMinor - order.refundedMinor;
  if (refundableMinor <= 0) throw new OrderError("Nothing left to refund", 409);

  let sellerName = "the seller";
  let itemTitle = "the item";
  let capMinor = DEFAULT_CAP_MINOR;
  if (order.negotiationId) {
    const [row] = await db
      .select({ seller: schema.sellers, listing: schema.listings })
      .from(schema.negotiations)
      .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
      .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
      .where(eq(schema.negotiations.id, order.negotiationId));
    if (row) {
      sellerName = row.seller.name;
      itemTitle = row.listing.title;
      capMinor = row.listing.refundCapMinor ?? row.seller.refundCapMinor;
    }
  }

  const proposal = await proposeRefund({
    sellerName,
    itemTitle,
    paidMinor: order.amountMinor,
    refundableMinor,
    capMinor,
    currency: order.currency,
    description: input.description,
    photo: input.photo,
  });

  // Guardrails library: the agent's number (never the complaint text) is checked
  // against what was captured, the seller's cap on the order's total refunds,
  // and the automatic-refund limit. A failed model never refunds by itself.
  const record: OrderRecord = {
    id: order.id,
    amountMinor: order.amountMinor,
    currency: order.currency,
    status: order.refundedMinor > 0 ? "PARTIALLY_REFUNDED" : "CAPTURED",
    authorizationId: order.authorizationId,
    captureId: order.captureId,
    capturedMinor: order.amountMinor,
    refundedTotalMinor: order.refundedMinor,
    refundCount: order.refundIds.length,
    autoRefundCount: order.agentRefundMessage ? 1 : 0,
    shipByMs: 0,
  };
  const check = evaluateRefund(
    record,
    { amountMinor: proposal.amountMinor, currency: order.currency, approvedBy: "agent" },
    { refundCapMinor: capMinor, maxAutoRefundsPerOrder: MAX_AUTO_REFUNDS },
  );
  if (check.verdict === "DENY") throw new OrderError(`This refund can't be made: ${check.reason}`, 409);
  const auto = check.verdict === "ALLOW" && proposal.source === "agent";

  const result = auto
    ? await refundOrder(orderId, { amountMinor: proposal.amountMinor, requestKey: input.requestKey, approvedBy: "agent", note: proposal.message })
    : { outcome: "NEEDS_SELLER_APPROVAL" as const };

  // Saved only after the refund went through or was parked, so a failed PayPal
  // call never leaves a "refunded" message behind.
  const pending = result.outcome === "NEEDS_SELLER_APPROVAL";
  await db
    .update(schema.orders)
    .set({
      problemNote: input.description,
      problemPhoto: input.photo ? `data:${input.photo.mediaType};base64,${input.photo.base64}` : null,
      agentRefundMessage: pending
        ? `${proposal.message} (Waiting for ${sellerName} to approve this amount.)`
        : proposal.message,
      ...(pending ? { pendingRefundMinor: proposal.amountMinor } : {}),
    })
    .where(eq(schema.orders.id, orderId));

  if (pending) await notifyOrder(orderId, "refund_pending", proposal.amountMinor);
  return {
    outcome: result.outcome,
    amountMinor: proposal.amountMinor,
    message: proposal.message,
    source: proposal.source,
    order: await getOrderRow(orderId),
  };
}
