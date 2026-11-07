"use client";

// Buyer's "My orders": past requests (negotiation rooms) and orders.
import { useEffect, useState } from "react";
import Link from "next/link";

interface Activity {
  mandates: { id: string; requestText: string; status: string; createdAt: string }[];
  orders: { id: string; mandateId: string; status: string; amountMinor: number; refundedMinor: number; title: string; seller: string }[];
}
const REQUEST_LABEL: Record<string, string> = {
  confirmed: "Starting",
  negotiating: "Negotiating",
  recommended: "Deal ready",
  no_deal: "No deal",
  no_match: "No sellers",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
  failed: "Failed",
};
const ORDER_LABEL: Record<string, string> = {
  AUTHORIZED: "Held, waiting to ship",
  SHIPPED: "Shipping",
  CAPTURED: "Shipped",
  REFUNDED: "Refunded",
  VOIDED: "Cancelled, not charged",
};
// Chip colour per status: indigo in progress, haldi agreed, leaf money safe/done, madder failed.
const ORDER_CHIP: Record<string, string> = {
  AUTHORIZED: "chip-safe",
  SHIPPED: "chip-progress",
  CAPTURED: "chip-safe",
  REFUNDED: "",
  VOIDED: "",
};
const REQUEST_CHIP: Record<string, string> = {
  confirmed: "chip-progress",
  negotiating: "chip-progress",
  recommended: "chip-agreed",
  failed: "chip-bad",
  interrupted: "chip-bad",
};
const gbp = (m: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(m / 100);

export default function OrdersPage() {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/me/activity").then(async (r) => (r.ok ? setData(await r.json()) : setError((await r.json()).error)));
  }, []);

  if (error)
    return (
      <main className="page-narrow">
        <div className="panel p-8">
          <h1 className="title text-2xl">My orders</h1>
          <p className="mt-2 text-ink-2">{error}</p>
          <Link href="/login?next=/orders" className="btn btn-primary mt-6">
            Log in
          </Link>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="page-narrow space-y-3" aria-busy="true">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-surface" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-[1.25rem] bg-surface" />
        ))}
      </main>
    );
  // A request whose deal was paid for reads "Ordered", not "Deal ready".
  const ordered = new Set(data.orders.filter((o) => o.status !== "VOIDED").map((o) => o.mandateId));
  return (
    <main className="page-narrow space-y-12">
      <section>
        <h1 className="display text-4xl">My orders</h1>
        {data.orders.length === 0 ? (
          <div className="well mt-6 p-6">
            <p className="font-semibold">No orders yet</p>
            <p className="mt-1 text-ink-2">When you approve a deal in PayPal, the order and its tracking appear here.</p>
            <Link href="/shop" className="btn btn-primary btn-sm mt-4">
              Send your agent shopping
            </Link>
          </div>
        ) : (
          <ul className="panel mt-6 divide-y divide-line overflow-hidden">
            {data.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/order/${o.id}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 p-4 hover:bg-surface sm:p-5">
                  <span className="min-w-0">
                    <span className="block font-semibold">{o.title}</span>
                    <span className="block text-sm text-ink-3">from {o.seller}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="text-right">
                      <span className="money block text-lg">{gbp(o.amountMinor)}</span>
                      {o.refundedMinor > 0 && o.status !== "REFUNDED" && (
                        <span className="block text-sm text-ink-3">{gbp(o.refundedMinor)} refunded</span>
                      )}
                    </span>
                    <span className={`chip ${ORDER_CHIP[o.status] ?? ""}`}>{ORDER_LABEL[o.status] ?? o.status}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <CustomOrders />
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="title text-2xl">My requests</h2>
          <Link href="/shop" className="btn btn-secondary btn-sm">
            New request
          </Link>
        </div>
        {data.mandates.length === 0 ? (
          <p className="well mt-4 p-5 text-ink-2">Requests you send to your agent show up here, with their negotiation rooms.</p>
        ) : (
          <ul className="panel mt-4 divide-y divide-line overflow-hidden">
            {data.mandates.map((m) => {
              const isOrdered = ordered.has(m.id);
              return (
                <li key={m.id}>
                  <Link href={`/deal/${m.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-surface sm:p-5">
                    <span className="min-w-0">&ldquo;{m.requestText}&rdquo;</span>
                    <span className={`chip shrink-0 ${isOrdered ? "chip-safe" : (REQUEST_CHIP[m.status] ?? "")}`}>
                      {isOrdered ? "Ordered" : (REQUEST_LABEL[m.status] ?? m.status)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

interface Commission {
  id: string;
  listingId: string;
  title: string;
  seller: string;
  request: string;
  price: number | null;
  readyInDays: number;
  agentNote: string;
  status: string;
  invoiceUrl: string | null;
}
const COMMISSION_LABEL: Record<string, { label: string; chip: string }> = {
  AWAITING_SELLER: { label: "Waiting for the maker", chip: "chip-progress" },
  INVOICING: { label: "Sending invoice", chip: "chip-progress" },
  INVOICED: { label: "Invoice ready to pay", chip: "chip-agreed" },
  PAID: { label: "Paid, being made", chip: "chip-safe" },
  DECLINED: { label: "Maker declined", chip: "" },
};

/** Made-to-order requests and their PayPal invoices. */
function CustomOrders() {
  const [items, setItems] = useState<Commission[] | null>(null);
  useEffect(() => {
    fetch("/api/commissions")
      .then((r) => (r.ok ? r.json() : { commissions: [] }))
      .then((b) => setItems(b.commissions));
  }, []);
  if (!items || items.length === 0) return null;
  return (
    <section>
      <h2 className="title text-2xl">Custom orders</h2>
      <ul className="panel mt-4 divide-y divide-line overflow-hidden">
        {items.map((c) => (
          <li key={c.id} className="space-y-2 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span className="min-w-0">
                <Link href={`/listing/${c.listingId}`} className="block font-semibold hover:underline">
                  {c.title}
                </Link>
                <span className="block text-sm text-ink-3">by {c.seller}</span>
              </span>
              <span className="flex items-center gap-3">
                {c.price != null && <span className="money text-lg">{gbp(Math.round(c.price * 100))}</span>}
                <span className={`chip ${COMMISSION_LABEL[c.status]?.chip ?? ""}`}>{COMMISSION_LABEL[c.status]?.label ?? c.status}</span>
              </span>
            </div>
            <p className="text-ink-2">&ldquo;{c.request}&rdquo;</p>
            {c.status !== "AWAITING_SELLER" && c.status !== "DECLINED" && (
              <p className="text-sm text-ink-3">
                {c.agentNote} Ready in about {c.readyInDays} days.
              </p>
            )}
            {c.status === "INVOICED" && c.invoiceUrl && (
              <a href={c.invoiceUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
                Pay the invoice in PayPal
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
