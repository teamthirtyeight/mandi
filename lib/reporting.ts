// PayPal's own record, next to Mandix's.
//
// statementFor(): the seller's PayPal statement, from the Transaction Search API
// (Agent Toolkit list_transactions), matched line by line to Mandix's orders, so
// the seller can see the two agree.
// paypalOrderStatus(): one order as PayPal sees it right now (toolkit get_order).
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { runPlatformTool } from "@/lib/paypal/toolkit";

const EVENT_LABEL: Record<string, string> = {
  T0001: "Payout to seller",
  T0006: "Buyer payment (checkout)",
  T0003: "Buyer payment",
  T0007: "Buyer payment",
  T0011: "Buyer payment",
  T0002: "Subscription payment",
  T1107: "Refund to buyer",
  T1106: "Payment reversal",
  T1105: "Hold released",
  T1503: "Hold released",
  T0400: "Withdrawal",
  T0013: "Donation",
  T0000: "Transfer",
};

export interface StatementLine {
  id: string;
  date: string;
  type: string;
  code: string;
  amount: number;
  currency: string;
  paypalStatus: string;
  /** The Mandix order this line belongs to, if any. */
  orderId: string | null;
  listing: string | null;
  /** Mandix's amount for the same thing, and whether the two agree to the penny. */
  mandixAmount: number | null;
  matches: boolean | null;
}

interface TxInfo {
  transaction_id: string;
  transaction_event_code?: string;
  transaction_amount?: { value: string; currency_code: string };
  transaction_status?: string;
  transaction_initiation_date?: string;
  paypal_reference_id?: string;
}

const cache = new Map<string, { at: number; value: { lines: StatementLine[]; unmatched: number } }>();

/**
 * The seller's lines from PayPal's statement for the last 30 days. Mandix's
 * merchant account is shared, so only lines that match one of this seller's
 * orders (capture, refund or payout) are shown.
 */
export async function statementFor(sellerId: string, now = new Date()): Promise<{ lines: StatementLine[]; unmatched: number }> {
  const hit = cache.get(sellerId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;

  const orders = await db
    .select({ o: schema.orders, title: schema.listings.title })
    .from(schema.orders)
    .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .where(eq(schema.listings.sellerId, sellerId));

  // Each PayPal id Mandix recorded, mapped to the order and Mandix's amount for it.
  const known = new Map<string, { orderId: string; title: string; kind: "capture" | "refund" | "payout"; minor: number | null }>();
  for (const { o, title } of orders) {
    if (o.captureId) known.set(o.captureId, { orderId: o.id, title, kind: "capture", minor: o.amountMinor });
    for (const r of o.refundIds) known.set(r, { orderId: o.id, title, kind: "refund", minor: null });
    if (o.payoutBatchId) known.set(o.payoutBatchId, { orderId: o.id, title, kind: "payout", minor: o.payoutMinor });
  }

  const start = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const body = await runPlatformTool<{ transaction_details?: { transaction_info: TxInfo }[] }>(
    "list_transactions",
    { start_date: start.toISOString().replace(/\.\d+Z$/, "Z"), end_date: now.toISOString().replace(/\.\d+Z$/, "Z"), page_size: 100 },
    { label: "seller statement" },
  );

  const lines: StatementLine[] = [];
  let unmatched = 0;
  for (const { transaction_info: t } of body.transaction_details ?? []) {
    const match = known.get(t.transaction_id) ?? (t.paypal_reference_id ? known.get(t.paypal_reference_id) : undefined);
    if (!match) {
      unmatched++;
      continue;
    }
    const value = Number(t.transaction_amount?.value ?? 0);
    const code = t.transaction_event_code ?? "";
    const mandixAmount = match.minor != null ? match.minor / 100 : null;
    lines.push({
      id: t.transaction_id,
      date: t.transaction_initiation_date ?? "",
      type: EVENT_LABEL[code] ?? (match.kind === "refund" ? "Refund to buyer" : match.kind === "payout" ? "Payout to seller" : "Payment"),
      code,
      amount: value,
      currency: t.transaction_amount?.currency_code ?? "GBP",
      paypalStatus: STATUS[t.transaction_status ?? ""] ?? t.transaction_status ?? "",
      orderId: match.orderId,
      listing: match.title,
      mandixAmount,
      // Payouts and refunds show as negative on Mandix's statement.
      matches: mandixAmount == null ? null : Math.abs(Math.abs(value) - mandixAmount) < 0.005,
    });
  }
  lines.sort((a, b) => b.date.localeCompare(a.date));
  const value = { lines, unmatched };
  cache.set(sellerId, { at: Date.now(), value });
  return value;
}

const STATUS: Record<string, string> = { S: "Completed", P: "Pending", D: "Denied", V: "Reversed" };

export interface PaypalOrderView {
  id: string;
  status: string;
  payments: { kind: "Hold" | "Capture" | "Refund"; id: string; status: string; amount: string }[];
}

/** One order as PayPal sees it now, through the Agent Toolkit's get_order. */
export async function paypalOrderStatus(paypalOrderId: string, orderId?: string): Promise<PaypalOrderView> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await runPlatformTool<any>("get_order", { id: paypalOrderId }, { label: "order status", orderId });
  const payments = body.purchase_units?.[0]?.payments ?? {};
  const money = (a?: { value?: string; currency_code?: string }) => (a?.value ? `${a.currency_code ?? ""} ${a.value}`.trim() : "");
  const list: PaypalOrderView["payments"] = [];
  for (const a of payments.authorizations ?? []) list.push({ kind: "Hold", id: a.id, status: a.status, amount: money(a.amount) });
  for (const c of payments.captures ?? []) list.push({ kind: "Capture", id: c.id, status: c.status, amount: money(c.amount) });
  for (const r of payments.refunds ?? []) list.push({ kind: "Refund", id: r.id, status: r.status, amount: money(r.amount) });
  return { id: body.id ?? paypalOrderId, status: body.status ?? "UNKNOWN", payments: list };
}
