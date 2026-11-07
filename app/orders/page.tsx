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
