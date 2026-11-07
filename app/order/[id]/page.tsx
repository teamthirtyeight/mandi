"use client";

// Order tracker for both sides. Seller: enter tracking (captures the held
// money and attaches tracking), extend or release the hold, refund.
// Buyer: report a problem; the seller's agent can refund within its cap.
import { use, useCallback, useEffect, useRef, useState } from "react";
import { PayPalCallLog } from "@/components/PayPalCallLog";
import { ShippingAddress, type Shipping } from "@/components/ShippingAddress";

interface Order {
  id: string;
  paypalOrderId: string | null;
  authorizationId: string | null;
  captureId: string | null;
  amountMinor: number;
  currency: string;
  refundedMinor: number;
  status: "CREATED" | "APPROVED" | "AUTHORIZED" | "SHIPPED" | "CAPTURED" | "REFUNDED" | "VOIDED";
  trackingNumber: string | null;
  carrier: string | null;
  problemNote: string | null;
  agentRefundMessage: string | null;
  pendingRefundMinor: number | null;
  shipping: Shipping | null;
}

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

// The order's life in plain words: held by PayPal, shipped, paid to the seller,
// and (only if it happens) refunded.
const STEPS = [
  { key: "held", label: "Held", detail: "PayPal holds the money" },
  { key: "shipped", label: "Shipped", detail: "Tracking added" },
  { key: "paid", label: "Paid", detail: "Money released to the seller" },
  { key: "refunded", label: "Refunded", detail: "Money back to the buyer" },
] as const;

function stepsDone(o: Order): Record<(typeof STEPS)[number]["key"], boolean> {
  const rank = { CREATED: 0, APPROVED: 0, AUTHORIZED: 1, SHIPPED: 2, CAPTURED: 3, REFUNDED: 4, VOIDED: 1 }[o.status];
  return {
    held: rank >= 1,
    shipped: rank >= 2 || o.trackingNumber != null,
    paid: rank >= 3,
    refunded: o.refundedMinor > 0,
  };
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);
  // "buyer" or "seller" for a real deal; "both" for /paypal-test orders.
  const [viewer, setViewer] = useState<"buyer" | "seller" | "both">("both");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [carrier, setCarrier] = useState("India Post");
  const [tracking, setTracking] = useState("");
  const [refundPounds, setRefundPounds] = useState("10.00");
  const refundKey = useRef<string>(crypto.randomUUID());
  const problemKey = useRef<string>(crypto.randomUUID());
  const [problem, setProblem] = useState("");
  const [problemPhoto, setProblemPhoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${id}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) setError(body.error);
    else {
      setOrder(body.order);
      setViewer(body.viewer);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/orders/${id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Request failed");
      else {
        if (json.order) setOrder(json.order);
        if (json.trackingWarning) setNotice(`Captured, but tracking was not attached: ${json.trackingWarning}`);
        if (json.outcome === "NEEDS_SELLER_APPROVAL") setNotice("This refund is above the seller's limit, so it's waiting for their approval.");
      }
      return res.ok;
    } finally {
      setBusy(false);
      setRefreshKey((k) => k + 1);
    }
  }

  if (error && !order)
    return (
      <main className="page-narrow">
        <div className="panel p-8">
          <h1 className="title text-2xl">We couldn&apos;t open this order</h1>
          <p className="mt-2 text-ink-2">{error}</p>
          <a href="/orders" className="btn btn-secondary mt-6">
            Go to my orders
          </a>
        </div>
      </main>
    );
  if (!order)
    return (
      <main className="page space-y-4" aria-busy="true">
        <div className="h-12 w-40 animate-pulse rounded-lg bg-surface" />
        <div className="h-20 animate-pulse rounded-[1.25rem] bg-surface" />
        <div className="h-48 animate-pulse rounded-[1.25rem] bg-surface" />
      </main>
    );

  const done = stepsDone(order);
  const remaining = order.amountMinor - order.refundedMinor;
  const headline =
    order.status === "VOIDED"
      ? "Hold released"
      : order.status === "REFUNDED"
        ? "Refunded in full"
        : order.status === "CAPTURED"
          ? "Shipped and paid"
          : order.status === "SHIPPED"
            ? "Shipped"
            : order.status === "AUTHORIZED"
              ? viewer === "buyer"
                ? "Money held until it ships"
                : "Money held: ship it now"
              : "Waiting for PayPal approval";

  return (
    <main className="page grid items-start gap-8 lg:grid-cols-[1fr_380px]">
      <section className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-ink-3">{headline}</p>
            <h1 className="display mt-1 text-5xl">
              <span className="money">{money(order.amountMinor, order.currency)}</span>
            </h1>
          </div>
          <p className="text-right text-sm text-ink-3">
            PayPal order
            <span className="block font-mono text-ink-2">{order.paypalOrderId}</span>
          </p>
        </header>

        {order.status === "VOIDED" ? (
          <p className="notice">The hold was released before shipping. The buyer was not charged.</p>
        ) : (
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Order progress">
            {STEPS.map((s) => {
              const on = done[s.key];
              const tone = s.key === "refunded" ? "border-ink-3 bg-surface" : "border-leaf bg-leaf-soft";
              return (
                <li
                  key={s.key}
                  aria-current={on ? "step" : undefined}
                  className={`rounded-2xl border-2 px-3 py-2.5 ${on ? tone : "border-dashed border-line"}`}
                >
                  <p className={`flex items-center gap-1.5 font-semibold ${on ? (s.key === "refunded" ? "text-ink" : "text-leaf") : "text-ink-3"}`}>
                    {on && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    )}
                    {s.label}
                  </p>
                  <p className={`text-xs ${on ? "text-ink-2" : "text-ink-3"}`}>{s.detail}</p>
                </li>
              );
            })}
          </ol>
        )}

        {order.status === "AUTHORIZED" && viewer === "buyer" && (
          <p className="notice notice-safe">
            Your {money(order.amountMinor, order.currency)} is held by PayPal, not paid. The seller is paid only when they add
            tracking. If they can&apos;t ship, the hold is released and you aren&apos;t charged.
          </p>
        )}

        {order.status === "AUTHORIZED" && viewer !== "buyer" && (
          <div className="panel overflow-hidden">
            <div className="border-b border-line p-5">
              <h2 className="title text-xl">Ship within 3 days</h2>
              <p className="hint mt-1">
                Adding tracking releases the held {money(order.amountMinor, order.currency)} to you and sends the tracking to
                PayPal.
              </p>
            </div>
            <div className="grid gap-6 p-5 md:grid-cols-[1fr_1.4fr]">
              <div className="well p-4">
                {order.shipping ? (
                  <ShippingAddress shipping={order.shipping} />
                ) : (
                  <p className="text-sm text-ink-3">The buyer&apos;s address appears here once PayPal shares it.</p>
                )}
              </div>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  act("ship", { carrier, trackingNumber: tracking });
                }}
              >
                <div>
                  <label htmlFor="carrier" className="label">
                    Carrier
                  </label>
                  <input id="carrier" className="field" value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-label="Carrier" />
                </div>
                <div>
                  <label htmlFor="tracking" className="label">
                    Tracking number
                  </label>
                  <input
                    id="tracking"
                    className="field font-mono"
                    placeholder="e.g. EE123456789IN"
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                    aria-label="Tracking number"
                  />
                </div>
                <button disabled={busy || tracking.trim().length < 4} className="btn btn-primary w-full">
                  {busy ? "Sending to PayPal…" : "Mark as shipped and get paid"}
                </button>
              </form>
            </div>
            <div className="flex flex-wrap gap-x-2 border-t border-line bg-surface px-3 py-2">
              <button
                disabled={busy}
                onClick={async () => {
                  if (await act("extend", {})) setNotice("Hold renewed. You have more time to ship.");
                }}
                className="btn btn-quiet btn-sm"
              >
                Need more time? Extend the hold
              </button>
              <button disabled={busy} onClick={() => act("void")} className="btn btn-quiet btn-sm text-madder">
                Can&apos;t ship? Release the hold
              </button>
            </div>
          </div>
        )}

        {order.trackingNumber && (
          <div className="well flex flex-wrap items-center justify-between gap-3 p-4">
            <p>
              <span className="text-ink-3">Tracking with {order.carrier}</span>
              <span className="block font-mono text-lg">{order.trackingNumber}</span>
            </p>
            {order.refundedMinor > 0 && (
              <p className="text-right">
                <span className="text-ink-3">Refunded so far</span>
                <span className="money block text-lg">{money(order.refundedMinor, order.currency)}</span>
              </p>
            )}
          </div>
        )}

        {order.problemNote && (
          <div className="panel space-y-4 p-5">
            <div>
              <p className="text-sm text-ink-3">Buyer reported</p>
              <p className="mt-1 rounded-2xl rounded-br-md bg-indigo-soft px-4 py-2.5">{order.problemNote}</p>
            </div>
            {order.agentRefundMessage && (
              <div>
                <p className="text-sm text-ink-3">Seller&apos;s agent replied</p>
                <p className="mt-1 rounded-2xl rounded-bl-md bg-surface px-4 py-2.5">{order.agentRefundMessage}</p>
              </div>
            )}
            {order.pendingRefundMinor != null && viewer !== "buyer" && (
              <div className="notice flex flex-wrap items-center justify-between gap-3">
                <span>This refund is above your agent&apos;s limit, so it needs your approval.</span>
                <button
                  disabled={busy}
                  onClick={async () => {
                    const ok = await act("refund", {
                      amountMinor: order.pendingRefundMinor,
                      requestKey: refundKey.current,
                      approvedBy: "seller",
                    });
                    if (ok) refundKey.current = crypto.randomUUID();
                  }}
                  className="btn btn-primary btn-sm"
                >
                  Approve {money(order.pendingRefundMinor, order.currency)} refund
                </button>
              </div>
            )}
          </div>
        )}

        {order.status === "CAPTURED" && remaining > 0 && !order.problemNote && viewer !== "seller" && (
          <div className="panel p-5">
            <h2 className="title text-xl">Something wrong with the item?</h2>
            <p className="hint mt-1">Tell the seller what happened. Their agent can offer a refund straight away.</p>
            <form
              className="mt-4 space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await act("problem", {
                  description: problem,
                  requestKey: problemKey.current,
                  ...(problemPhoto ? { photo: problemPhoto } : {}),
                });
                if (ok) problemKey.current = crypto.randomUUID();
              }}
            >
              <textarea
                className="field"
                rows={3}
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                placeholder="e.g. A thread has pulled near the border."
                aria-label="Describe the problem"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="text-sm text-ink-2">
                  <span className="mr-2 font-semibold text-ink">Photo</span>(optional){" "}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="mt-1 block text-sm file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-raised file:px-3 file:py-1.5 file:font-semibold file:text-ink"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return setProblemPhoto(null);
                      const reader = new FileReader();
                      reader.onload = () => setProblemPhoto(String(reader.result));
                      reader.readAsDataURL(f);
                    }}
                  />
                </label>
                <button disabled={busy || problem.trim().length < 5} className="btn btn-primary">
                  {busy ? "Asking the seller's agent…" : "Report a problem"}
                </button>
              </div>
            </form>
          </div>
        )}

        {order.status === "CAPTURED" && remaining > 0 && viewer !== "buyer" && (
          <div className="panel p-5">
            <h2 className="title text-xl">Refund the buyer</h2>
            <p className="hint mt-1">Up to {money(remaining, order.currency)} left to refund. It goes back to their PayPal account.</p>
            <form
              className="mt-4 flex flex-wrap items-end gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const amountMinor = Math.round(Number(refundPounds) * 100);
                const ok = await act("refund", { amountMinor, requestKey: refundKey.current, approvedBy: "seller" });
                if (ok) refundKey.current = crypto.randomUUID();
              }}
            >
              <div>
                <label htmlFor="refund" className="label">
                  Amount (£)
                </label>
                <input
                  id="refund"
                  className="field money w-36"
                  inputMode="decimal"
                  value={refundPounds}
                  onChange={(e) => setRefundPounds(e.target.value)}
                  aria-label="Refund amount"
                />
              </div>
              <button type="button" disabled={busy} onClick={() => setRefundPounds((remaining / 100).toFixed(2))} className="btn btn-secondary">
                Full amount
              </button>
              <button disabled={busy} className="btn btn-primary">
                Refund
              </button>
            </form>
          </div>
        )}

        {order.refundedMinor > 0 && !order.trackingNumber && (
          <p className="text-ink-2">
            Refunded so far: <span className="money">{money(order.refundedMinor, order.currency)}</span>
          </p>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="notice notice-bad">
            {error}
          </p>
        )}
        {(order.status === "CAPTURED" || order.status === "REFUNDED" || order.problemNote) && (
          <a href={`/api/orders/${order.id}/evidence`} className="link inline-block text-sm">
            Download the dispute evidence pack (listing, chat log, tracking and photo)
          </a>
        )}
      </section>

      <div className="space-y-4 lg:sticky lg:top-24">
        {order.paypalOrderId && <PayPalNow orderId={order.id} refreshKey={refreshKey} />}
        <div className="panel overflow-hidden">
          <PayPalCallLog orderId={order.id} refreshKey={refreshKey} />
        </div>
      </div>
    </main>
  );
}

const PAYMENT_STATUS: Record<string, string> = {
  CREATED: "Held",
  CAPTURED: "Held",
  COMPLETED: "Completed",
  PENDING: "Pending",
  VOIDED: "Released",
  PARTIALLY_CAPTURED: "Partly captured",
  PARTIALLY_REFUNDED: "Partly refunded",
  REFUNDED: "Refunded",
  DENIED: "Denied",
};

/** The order as PayPal sees it right now, read through the Agent Toolkit's get_order. */
function PayPalNow({ orderId, refreshKey }: { orderId: string; refreshKey: number }) {
  const [view, setView] = useState<{ status: string; payments: { kind: string; id: string; status: string; amount: string }[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(`/api/orders/${orderId}/paypal`).then(async (r) => (r.ok ? setView(await r.json()) : setFailed(true)));
  }, [orderId, refreshKey]);
  if (failed) return null;
  return (
    <section className="panel p-4" aria-label="Live from PayPal">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Live from PayPal</h2>
        {view && <span className="chip chip-progress">{view.status}</span>}
      </div>
      {!view ? (
        <div className="mt-3 h-12 animate-pulse rounded-xl bg-surface" />
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm">
          {view.payments.map((p) => (
            <li key={p.id} className="flex justify-between gap-3">
              <span className="text-ink-2">
                {p.kind} <span className="font-mono text-xs text-ink-3">{p.id}</span>
              </span>
              <span>
                <span className="money">{p.amount}</span> · {PAYMENT_STATUS[p.status] ?? p.status}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint mt-2">Read just now from PayPal through the Agent Toolkit, not from Mandi&apos;s copy.</p>
    </section>
  );
}
