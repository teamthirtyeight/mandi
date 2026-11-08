"use client";

// Buyer's "My orders": past requests (negotiation rooms) and orders.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, ChatIcon, PackageIcon, SparkIcon } from "@/components/Icons";

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
        <div className="panel p-6 sm:p-8">
          <span className="icon-tile">
            <PackageIcon />
          </span>
          <h1 className="title mt-4 text-2xl">My orders</h1>
          <p className="mt-2 text-ink-2">{error}</p>
          <Link href="/login?next=/orders" className="btn btn-primary mt-6">
            Log in
          </Link>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="page-narrow space-y-10" aria-busy="true">
        <span className="sr-only">Loading your orders</span>
        <div className="flex items-end justify-between gap-4">
          <div className="h-9 w-44 animate-pulse rounded-lg bg-surface" />
          <div className="h-10 w-32 animate-pulse rounded-lg bg-surface" />
        </div>
        {[3, 2].map((rows, s) => (
          <div key={s}>
            <div className="mb-3 h-5 w-28 animate-pulse rounded bg-surface" />
            <div className="panel divide-y divide-line overflow-hidden">
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-3/5 animate-pulse rounded bg-surface" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-surface" />
                  </div>
                  <div className="h-5 w-24 animate-pulse rounded-full bg-surface" />
                  <div className="hidden h-4 w-16 animate-pulse rounded bg-surface sm:block" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </main>
    );
  // A request whose deal was paid for reads "Ordered", not "Deal ready".
  const ordered = new Set(data.orders.filter((o) => o.status !== "VOIDED").map((o) => o.mandateId));
  return (
    <main className="page-narrow space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[clamp(1.875rem,4vw,2.5rem)]">My orders</h1>
          <p className="mt-2 text-sm text-ink-3">Orders you&apos;ve paid for and the requests your agent is working on.</p>
        </div>
        <Link href="/shop" className="btn btn-primary">
          <SparkIcon size={16} />
          New request
        </Link>
      </header>

      <section aria-labelledby="orders-title">
        <SectionHead id="orders-title" title="Orders" count={data.orders.length} />
        {data.orders.length === 0 ? (
          <EmptyState
            icon={<PackageIcon />}
            title="No orders yet"
            body="When you approve a deal in PayPal, the order and its tracking appear here."
            action={
              <Link href="/shop" className="btn btn-secondary btn-sm min-h-10">
                Send your agent shopping
              </Link>
            }
          />
        ) : (
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1fr)_11rem_7.5rem_1rem] items-center gap-4 border-b border-line bg-surface px-5 py-2 text-xs font-medium text-ink-3 sm:grid">
              <span>Item</span>
              <span>Status</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            <ul className="divide-y divide-line">
              {data.orders.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/order/${o.id}`}
                    className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface sm:grid-cols-[minmax(0,1fr)_11rem_7.5rem_1rem] sm:px-5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{o.title}</span>
                      <span className="block truncate text-sm text-ink-3">from {o.seller}</span>
                    </span>
                    <span className="col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto">
                      <span className={`chip ${ORDER_CHIP[o.status] ?? ""}`}>{ORDER_LABEL[o.status] ?? o.status}</span>
                    </span>
                    <span className="col-start-2 row-span-2 row-start-1 text-right sm:col-start-auto sm:row-span-1 sm:row-start-auto">
                      <span className="money block text-ink">{gbp(o.amountMinor)}</span>
                      {o.refundedMinor > 0 && o.status !== "REFUNDED" && (
                        <span className="num block text-xs text-ink-3">{gbp(o.refundedMinor)} refunded</span>
                      )}
                    </span>
                    <Chevron />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <CustomOrders />

      <section aria-labelledby="requests-title">
        <SectionHead id="requests-title" title="Requests" count={data.mandates.length} />
        {data.mandates.length === 0 ? (
          <EmptyState
            icon={<ChatIcon />}
            title="No requests yet"
            body="Requests you send to your agent show up here, with their negotiation rooms."
            action={
              <Link href="/shop" className="btn btn-secondary btn-sm min-h-10">
                New request
              </Link>
            }
          />
        ) : (
          <div className="panel overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1fr)_8.5rem_6rem_1rem] items-center gap-4 border-b border-line bg-surface px-5 py-2 text-xs font-medium text-ink-3 sm:grid">
              <span>Request</span>
              <span>Status</span>
              <span className="text-right">Sent</span>
              <span />
            </div>
            <ul className="divide-y divide-line">
              {data.mandates.map((m) => {
                const isOrdered = ordered.has(m.id);
                return (
                  <li key={m.id}>
                    <Link
                      href={`/deal/${m.id}`}
                      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface sm:grid-cols-[minmax(0,1fr)_8.5rem_6rem_1rem] sm:px-5"
                    >
                      <span className="col-span-2 min-w-0 text-ink sm:col-span-1">&ldquo;{m.requestText}&rdquo;</span>
                      <span>
                        <span className={`chip ${isOrdered ? "chip-safe" : (REQUEST_CHIP[m.status] ?? "")}`}>
                          {isOrdered ? "Ordered" : (REQUEST_LABEL[m.status] ?? m.status)}
                        </span>
                      </span>
                      <time dateTime={m.createdAt} className="num text-right text-xs text-ink-3 sm:text-sm">
                        {shortDate(m.createdAt)}
                      </time>
                      <Chevron />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function SectionHead({ id, title, count }: { id: string; title: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h2 id={id} className="title text-base">
        {title}
      </h2>
      {count != null && count > 0 && <span className="num rounded-md bg-surface px-1.5 text-xs font-medium text-ink-3">{count}</span>}
    </div>
  );
}

function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="rounded-[0.875rem] border border-dashed border-line-strong px-6 py-10 text-center">
      <span className="icon-tile">{icon}</span>
      <p className="mt-3 font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">{body}</p>
      <div className="mt-4">{action}</div>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="hidden text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-2 sm:block"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
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
    <section aria-labelledby="custom-title">
      <SectionHead id="custom-title" title="Custom orders" count={items.length} />
      <ul className="panel divide-y divide-line overflow-hidden">
        {items.map((c) => (
          <li key={c.id} className="px-4 py-4 sm:px-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2">
              <span className="min-w-0">
                <Link href={`/listing/${c.listingId}`} className="block truncate font-medium text-ink hover:underline">
                  {c.title}
                </Link>
                <span className="block truncate text-sm text-ink-3">by {c.seller}</span>
              </span>
              <span className="text-right">{c.price != null && <span className="money text-ink">{gbp(Math.round(c.price * 100))}</span>}</span>
              <span className="col-span-2">
                <span className={`chip ${COMMISSION_LABEL[c.status]?.chip ?? ""}`}>{COMMISSION_LABEL[c.status]?.label ?? c.status}</span>
              </span>
            </div>
            <p className="well mt-3 px-3 py-2 text-sm text-ink-2">&ldquo;{c.request}&rdquo;</p>
            {c.status !== "AWAITING_SELLER" && c.status !== "DECLINED" && (
              <p className="mt-2 text-sm text-ink-3">
                {c.agentNote} Ready in about {c.readyInDays} days.
              </p>
            )}
            {c.status === "INVOICED" && c.invoiceUrl && (
              <a href={c.invoiceUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm mt-3 min-h-10">
                Pay the invoice in PayPal
                <ArrowRightIcon size={15} />
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
