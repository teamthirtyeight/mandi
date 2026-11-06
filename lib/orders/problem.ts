// Buyer reports a problem → seller agent proposes a refund → the order
// service refunds it if it is within the seller's cap, or parks it for the
// seller's tap if it is above. The agent never calls PayPal itself.
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { proposeRefund } from "@/lib/agents/refund";
import type { PhotoInput } from "@/lib/agents/listing";
import { getOrderRow, OrderError, refundOrder } from "./service";

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

  const result = await refundOrder(orderId, {
    amountMinor: proposal.amountMinor,
    requestKey: input.requestKey,
    approvedBy: "agent",
    note: proposal.message,
  });

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

  return {
    outcome: result.outcome,
    amountMinor: proposal.amountMinor,
    message: proposal.message,
    source: proposal.source,
    order: await getOrderRow(orderId),
  };
}
