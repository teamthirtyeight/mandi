/**
 * Runs the money rules and their database updates as one locked step, so
 * simultaneous requests can't both pass a check. Each money action claims its
 * right to proceed here, calls PayPal outside the transaction, then records the
 * result. Don't hold a transaction open during a PayPal call.
 */
import type { Pool, PoolClient } from "pg";
import { deny, type Decision } from "../core";
import {
  evaluateCapture,
  evaluateCreateOrder,
  evaluateRefund,
  orderParams,
  type CaptureParams,
  type CreateOrderParams,
  type FrozenDeal,
  type OrderRecord,
  type OrderStatus,
  type RefundParams,
  type RefundPolicy,
  type RefundProposal,
} from "../money";
import type { ConfirmedShipment } from "../shipment";

const UNIQUE_VIOLATION = "23505";
const DEFAULT_CAPTURE_LEASE_MS = 60_000;

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

interface OrderRow {
  id: string;
  negotiation_id: string;
  listing_id: string;
  amount_minor: number;
  currency: string;
  ship_to_country: string;
  ship_by_at: Date;
  status: OrderStatus;
  paypal_order_id: string | null;
  authorization_id: string | null;
  capture_id: string | null;
  captured_minor: number;
  refunded_total_minor: number;
  refund_count: number;
  auto_refund_count: number;
  tracking_number: string | null;
  capture_lease_until: Date | null;
}

const toOrderRecord = (row: OrderRow): OrderRecord => ({
  id: row.id,
  amountMinor: row.amount_minor,
  currency: row.currency,
  status: row.status,
  authorizationId: row.authorization_id,
  captureId: row.capture_id,
  capturedMinor: row.captured_minor,
  refundedTotalMinor: row.refunded_total_minor,
  refundCount: row.refund_count,
  autoRefundCount: row.auto_refund_count,
  shipByMs: row.ship_by_at.getTime(),
});

const lockOrder = async (client: PoolClient, orderId: string): Promise<OrderRow | null> => {
  const { rows } = await client.query<OrderRow>("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
  return rows[0] ?? null;
};

const NO_ORDER = deny("ORDER_NOT_FOUND", "no such order");

/* -------------------------------- Create order ------------------------------- */

export type ReserveResult =
  | { outcome: "reserved"; orderId: string; params: CreateOrderParams }
  /** A repeat of an earlier approval. Retry PayPal with these same params if needed. */
  | { outcome: "existing"; orderId: string; params: CreateOrderParams; paypalOrderId: string | null }
  | { outcome: "denied"; decision: Decision<CreateOrderParams> };

/**
 * Reserves stock and creates the one order for a deal. Locks the negotiation
 * first and the listing second, so simultaneous buyers queue rather than deadlock.
 */
export function reserveOrder(
  pool: Pool,
  input: { negotiationId: string; approvedHash: string; nowMs: number },
): Promise<ReserveResult> {
  return inTransaction(pool, async (client) => {
    const negotiation = (
      await client.query<{
        status: string;
        agreed_minor: number | null;
        frozen_deal: FrozenDeal | null;
        mandate_id: string;
        listing_id: string;
      }>("SELECT * FROM negotiations WHERE id = $1 FOR UPDATE", [input.negotiationId])
    ).rows[0];
    if (!negotiation?.frozen_deal) {
      return { outcome: "denied", decision: deny("DEAL_NOT_FOUND", "this negotiation has no frozen deal") };
    }
    const deal = negotiation.frozen_deal;

    const existing = (await client.query<OrderRow>("SELECT * FROM orders WHERE negotiation_id = $1", [input.negotiationId]))
      .rows[0];
    if (existing) {
      if (input.approvedHash !== deal.hash) {
        return { outcome: "denied", decision: deny("APPROVAL_MISMATCH", "the buyer approved different terms") };
      }
      return {
        outcome: "existing",
        orderId: existing.id,
        params: orderParams(deal),
        paypalOrderId: existing.paypal_order_id,
      };
    }

    const listing = (
      await client.query<{ stock: number; paypal_email: string }>(
        `SELECT l.stock, s.paypal_email
           FROM listings l JOIN sellers s ON s.id = l.seller_id
          WHERE l.id = $1 FOR UPDATE OF l`,
        [negotiation.listing_id],
      )
    ).rows[0];
    const mandate = (
      await client.query<{ max_price_minor: number; currency: string }>("SELECT * FROM mandates WHERE id = $1", [
        negotiation.mandate_id,
      ])
    ).rows[0];
    if (!listing || !mandate) {
      return { outcome: "denied", decision: deny("DEAL_NOT_FOUND", "the listing or mandate is missing") };
    }

    const decision = evaluateCreateOrder({
      deal,
      approvedHash: input.approvedHash,
      negotiationStatus: negotiation.status,
      negotiationAgreedMinor: negotiation.agreed_minor,
      mandate: { maxPriceMinor: mandate.max_price_minor, currency: mandate.currency },
      sellerPayeeEmail: listing.paypal_email,
      stockAvailable: listing.stock,
      existingOrderId: null,
      nowMs: input.nowMs,
    });
    if (decision.verdict !== "ALLOW") return { outcome: "denied", decision };

    const orderId = `ord_${input.negotiationId}`;
    await client.query("UPDATE listings SET stock = stock - 1 WHERE id = $1", [negotiation.listing_id]);
    await client.query(
      `INSERT INTO orders (id, negotiation_id, listing_id, amount_minor, currency, ship_to_country, ship_by_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'CREATED')`,
      [
        orderId,
        input.negotiationId,
        negotiation.listing_id,
        deal.amountMinor,
        deal.currency,
        deal.shipToCountry,
        new Date(deal.shipByMs),
      ],
    );
    await client.query("UPDATE negotiations SET status = 'ORDERED' WHERE id = $1", [input.negotiationId]);
    return { outcome: "reserved", orderId, params: decision.value };
  });
}

/** Gives the stock back if PayPal order creation fails or the buyer cancels the popup. */
export function releaseReservation(pool: Pool, orderId: string): Promise<boolean> {
  return inTransaction(pool, async (client) => {
    const found = (
      await client.query<{ negotiation_id: string; listing_id: string }>(
        "SELECT negotiation_id, listing_id FROM orders WHERE id = $1",
        [orderId],
      )
    ).rows[0];
    if (!found) return false;
    await client.query("SELECT id FROM negotiations WHERE id = $1 FOR UPDATE", [found.negotiation_id]);
    await client.query("SELECT id FROM listings WHERE id = $1 FOR UPDATE", [found.listing_id]);
    const removed = await client.query("DELETE FROM orders WHERE id = $1 AND status = 'CREATED'", [orderId]);
    if (removed.rowCount !== 1) return false;
    await client.query("UPDATE listings SET stock = stock + 1 WHERE id = $1", [found.listing_id]);
    await client.query("UPDATE negotiations SET status = 'AWAITING_BUYER_APPROVAL' WHERE id = $1", [
      found.negotiation_id,
    ]);
    return true;
  });
}

export async function recordAuthorization(
  pool: Pool,
  input: { orderId: string; paypalOrderId: string; authorizationId: string },
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE orders SET status = 'AUTHORIZED', paypal_order_id = $2, authorization_id = $3
      WHERE id = $1 AND status IN ('CREATED', 'APPROVED')`,
    [input.orderId, input.paypalOrderId, input.authorizationId],
  );
  return result.rowCount === 1;
}

/* ---------------------------------- Capture --------------------------------- */

export interface ClaimCaptureInput {
  orderId: string;
  carrier: string;
  trackingNumber: string;
  enteredBy: "seller" | "agent";
  /** Required, so capture can't happen without a confirmed shipment check. */
  shipment: ConfirmedShipment;
  nowMs: number;
  leaseMs?: number;
}

/**
 * Claims the right to capture. A crash after this leaves a lease that expires,
 * and retrying then reuses the same PayPal request ID, so it can't charge twice.
 */
export async function claimCapture(pool: Pool, input: ClaimCaptureInput): Promise<Decision<CaptureParams>> {
  try {
    return await inTransaction(pool, async (client) => {
      const row = await lockOrder(client, input.orderId);
      if (!row) return NO_ORDER;
      if (row.capture_lease_until && row.capture_lease_until.getTime() > input.nowMs) {
        return deny("CAPTURE_IN_PROGRESS", "another request is already capturing this order");
      }

      const used = await client.query("SELECT 1 FROM orders WHERE tracking_number = $1 AND id <> $2", [
        input.trackingNumber.replace(/[\s-]/g, "").toUpperCase(),
        input.orderId,
      ]);
      const decision = evaluateCapture({
        order: toOrderRecord(row),
        tracking: { carrier: input.carrier, number: input.trackingNumber, enteredBy: input.enteredBy },
        trackingUsedByOtherOrder: (used.rowCount ?? 0) > 0,
        nowMs: input.nowMs,
      });
      if (decision.verdict !== "ALLOW") return decision;
      if (row.tracking_number !== null && row.tracking_number !== decision.value.trackingNumber) {
        return deny("TRACKING_CHANGED", "this order already has a different tracking number");
      }

      await client.query(
        `UPDATE orders
            SET status = 'SHIPPED', carrier = $2, tracking_number = $3, tracking_entered_by = $4,
                shipment_verified_by = $5, capture_lease_until = $6
          WHERE id = $1`,
        [
          input.orderId,
          decision.value.carrier,
          decision.value.trackingNumber,
          input.enteredBy,
          input.shipment.source,
          new Date(input.nowMs + (input.leaseMs ?? DEFAULT_CAPTURE_LEASE_MS)),
        ],
      );
      return decision;
    });
  } catch (error) {
    // Another order claimed this number at the same moment. The unique index caught it.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return deny("TRACKING_REUSED", "tracking number is used by another order");
    }
    throw error;
  }
}

export async function completeCapture(pool: Pool, orderId: string, captureId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE orders
        SET status = 'CAPTURED', capture_id = $2, captured_minor = amount_minor, capture_lease_until = NULL
      WHERE id = $1 AND status = 'SHIPPED'`,
    [orderId, captureId],
  );
  return result.rowCount === 1;
}

/** Call only when PayPal definitely declined. Allows a retry right away. */
export async function releaseCapture(pool: Pool, orderId: string): Promise<void> {
  await pool.query("UPDATE orders SET capture_lease_until = NULL WHERE id = $1 AND status = 'SHIPPED'", [orderId]);
}

/* ---------------------------------- Refunds --------------------------------- */

/** Loads what decideRefund needs. The cap comes from the listing, never the request. */
export async function loadRefundContext(
  pool: Pool,
  orderId: string,
): Promise<{ order: OrderRecord; policy: RefundPolicy } | null> {
  const { rows } = await pool.query<OrderRow & { refund_cap_minor: number | null }>(
    `SELECT o.*, l.refund_cap_minor
       FROM orders o JOIN listings l ON l.id = o.listing_id
      WHERE o.id = $1`,
    [orderId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    order: toOrderRecord(row),
    policy: { refundCapMinor: row.refund_cap_minor, maxAutoRefundsPerOrder: 1 },
  };
}

/**
 * Claims a refund, counting it toward the totals before PayPal is called. Two
 * simultaneous refunds therefore can't both fit in the same room under the cap.
 * The cap comes from the listing, never from the caller or the agent.
 */
export function claimRefund(
  pool: Pool,
  input: { orderId: string; proposal: RefundProposal; maxAutoRefundsPerOrder?: number },
): Promise<Decision<RefundParams>> {
  return inTransaction(pool, async (client) => {
    const row = await lockOrder(client, input.orderId);
    if (!row) return NO_ORDER;
    const listing = (
      await client.query<{ refund_cap_minor: number | null }>("SELECT refund_cap_minor FROM listings WHERE id = $1", [
        row.listing_id,
      ])
    ).rows[0];

    const decision = evaluateRefund(toOrderRecord(row), input.proposal, {
      refundCapMinor: listing?.refund_cap_minor ?? null,
      maxAutoRefundsPerOrder: input.maxAutoRefundsPerOrder ?? 1,
    });
    if (decision.verdict !== "ALLOW") return decision;

    const { next, requestId } = decision.value;
    await client.query(
      `UPDATE orders SET status = $2, refunded_total_minor = $3, refund_count = $4, auto_refund_count = $5
        WHERE id = $1`,
      [input.orderId, next.status, next.refundedTotalMinor, next.refundCount, next.autoRefundCount],
    );
    await client.query(
      `INSERT INTO refunds (request_id, order_id, amount_minor, approved_by, status)
       VALUES ($1, $2, $3, $4, 'PENDING')`,
      [requestId, input.orderId, input.proposal.amountMinor, input.proposal.approvedBy],
    );
    return decision;
  });
}

export async function completeRefund(pool: Pool, requestId: string, paypalRefundId: string): Promise<boolean> {
  const result = await pool.query(
    "UPDATE refunds SET status = 'COMPLETED', paypal_refund_id = $2 WHERE request_id = $1 AND status = 'PENDING'",
    [requestId, paypalRefundId],
  );
  return result.rowCount === 1;
}

/**
 * Call only when PayPal definitely rejected the refund. If the result is unknown,
 * such as a timeout, keep it PENDING and retry with the same request ID.
 * refund_count isn't reduced, so later refunds never reuse this request ID.
 */
export function releaseRefund(pool: Pool, requestId: string): Promise<boolean> {
  return inTransaction(pool, async (client) => {
    const refund = (
      await client.query<{ order_id: string }>("SELECT order_id FROM refunds WHERE request_id = $1", [requestId])
    ).rows[0];
    if (!refund) return false;
    // Same lock order as claimRefund: the order first, then the refund row.
    await lockOrder(client, refund.order_id);
    const claimed = await client.query<{ amount_minor: number; approved_by: string }>(
      "UPDATE refunds SET status = 'RELEASED' WHERE request_id = $1 AND status = 'PENDING' RETURNING amount_minor, approved_by",
      [requestId],
    );
    const released = claimed.rows[0];
    if (!released) return false;
    await client.query(
      `UPDATE orders
          SET refunded_total_minor = refunded_total_minor - $2,
              auto_refund_count = auto_refund_count - $3,
              status = CASE WHEN refunded_total_minor - $2 = 0 THEN 'CAPTURED' ELSE 'PARTIALLY_REFUNDED' END
        WHERE id = $1`,
      [refund.order_id, released.amount_minor, released.approved_by === "agent" ? 1 : 0],
    );
    return true;
  });
}
