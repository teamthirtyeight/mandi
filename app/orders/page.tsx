"use client";

// Buyer's "My orders": past requests (negotiation rooms) and orders.
import { useEffect, useState } from "react";
import Link from "next/link";

interface Activity {
  mandates: { id: string; requestText: string; status: string; createdAt: string }[];
  orders: { id: string; status: string; amountMinor: number; refundedMinor: number; title: string; seller: string }[];
}
const gbp = (m: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(m / 100);

export default function OrdersPage() {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/me/activity").then(async (r) => (r.ok ? setData(await r.json()) : setError((await r.json()).error)));
  }, []);

  if (error) return <main className="p-8">{error} <Link href="/login?next=/orders" className="underline">Log in</Link></main>;
  if (!data) return <main className="p-8 text-neutral-500">Loading…</main>;
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <section>
        <h1 className="mb-3 text-3xl font-semibold">My orders</h1>
        {data.orders.length === 0 ? (
          <p className="text-neutral-500">No orders yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.orders.map((o) => (
              <li key={o.id}>
                <Link href={`/order/${o.id}`} className="flex justify-between rounded-xl border border-neutral-200 p-4 hover:bg-neutral-50">
                  <span>
                    {o.title} · {o.seller}
                  </span>
                  <span>
                    {gbp(o.amountMinor - o.refundedMinor)} · {o.status.toLowerCase()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">My requests</h2>
        <ul className="space-y-2">
          {data.mandates.map((m) => (
            <li key={m.id}>
              <Link href={`/deal/${m.id}`} className="flex justify-between rounded-xl border border-neutral-200 p-4 hover:bg-neutral-50">
                <span>&ldquo;{m.requestText}&rdquo;</span>
                <span className="text-neutral-500">{m.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
