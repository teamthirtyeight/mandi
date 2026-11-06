"use client";

// Order tracker. Day 2: driven by plain buttons (no AI yet).
// Seller: enter tracking (captures + attaches tracking) or void.
// Refund: partial or full, issued by the seller.
import { use, useCallback, useEffect, useRef, useState } from "react";
import { PayPalCallLog } from "@/components/PayPalCallLog";

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
}

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

const STEPS = ["Authorized", "Shipped", "Captured", "Refunded"] as const;

function stepsDone(o: Order): Record<(typeof STEPS)[number], boolean> {
  const rank = { CREATED: 0, APPROVED: 0, AUTHORIZED: 1, SHIPPED: 2, CAPTURED: 3, REFUNDED: 4, VOIDED: 1 }[o.status];
  return {
    Authorized: rank >= 1,
    Shipped: rank >= 2,
    Captured: rank >= 3,
    Refunded: o.refundedMinor > 0,
  };
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [carrier, setCarrier] = useState("India Post");
  const [tracking, setTracking] = useState("");
  const [refundPounds, setRefundPounds] = useState("10.00");
  const refundKey = useRef<string>(crypto.randomUUID());
  const problemKey = useRef<string>(crypto.randomUUID());
  const [problem, setProblem] = useState("A thread has pulled near the border.");
  const [problemPhoto, setProblemPhoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${id}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) setError(body.error);
    else setOrder(body.order);
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
        if (json.outcome === "NEEDS_SELLER_APPROVAL") setNotice("Above the seller's refund cap — waiting for the seller's tap.");
      }
      return res.ok;
    } finally {
      setBusy(false);
      setRefreshKey((k) => k + 1);
    }
  }

  if (error && !order) return <main className="p-8 text-red-700">{error}</main>;
  if (!order) return <main className="p-8 text-neutral-500">Loading order…</main>;

  const done = stepsDone(order);
  const remaining = order.amountMinor - order.refundedMinor;

  return (
    <main className="mx-auto grid max-w-6xl gap-8 p-8 lg:grid-cols-[1fr_420px]">
      <section className="space-y-6">
        <header>
          <p className="text-sm uppercase tracking-wide text-neutral-500">Order</p>
          <h1 className="text-[28px] font-semibold">{money(order.amountMinor, order.currency)}</h1>
          <p className="font-mono text-sm text-neutral-500">PayPal {order.paypalOrderId}</p>
        </header>

        {order.status === "VOIDED" ? (
          <p className="rounded-xl border border-neutral-300 bg-neutral-50 p-4">Hold released. The buyer was not charged.</p>
        ) : (
          <ol className="grid grid-cols-4 gap-2">
            {STEPS.map((s) => (
              <li
                key={s}
                className={`rounded-lg border p-3 text-center ${done[s] ? "border-green-300 bg-green-50 text-green-900" : "border-neutral-200 text-neutral-400"}`}
              >
                {s}
              </li>
            ))}
          </ol>
        )}

        {order.status === "AUTHORIZED" && (
          <div className="rounded-xl border border-neutral-200 p-5">
            <p className="mb-3 text-lg font-medium">{money(order.amountMinor, order.currency)} held — ship within 3 days</p>
            <form
              className="flex flex-wrap gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                act("ship", { carrier, trackingNumber: tracking });
              }}
            >
              <input
                className="rounded-lg border border-neutral-300 px-3 py-2"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                aria-label="Carrier"
              />
              <input
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2"
                placeholder="Tracking number"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                aria-label="Tracking number"
              />
              <button disabled={busy || tracking.trim().length < 4} className="rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-40">
                Ship and capture
              </button>
            </form>
            <button
              disabled={busy}
              onClick={() => act("void")}
              className="mt-3 text-sm text-neutral-500 underline disabled:opacity-40"
            >
              Can&apos;t ship — release the hold
            </button>
          </div>
        )}

        {order.trackingNumber && (
          <p className="text-neutral-700">
            Tracking: {order.carrier} <span className="font-mono">{order.trackingNumber}</span>
          </p>
        )}

        {order.problemNote && (
          <div className="rounded-xl border border-neutral-200 p-5">
            <p className="text-sm text-neutral-500">Buyer reported</p>
            <p>{order.problemNote}</p>
            {order.agentRefundMessage && (
              <>
                <p className="mt-3 text-sm text-neutral-500">Seller&apos;s agent replied</p>
                <p>{order.agentRefundMessage}</p>
              </>
            )}
            {order.pendingRefundMinor != null && (
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
                className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-40"
              >
                Seller: approve {money(order.pendingRefundMinor, order.currency)} refund
              </button>
            )}
          </div>
        )}

        {order.status === "CAPTURED" && remaining > 0 && !order.problemNote && (
          <div className="rounded-xl border border-neutral-200 p-5">
            <p className="mb-3 font-medium">Buyer: something wrong with the item?</p>
            <form
              className="space-y-3"
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
                className="w-full rounded-lg border border-neutral-300 p-3"
                rows={2}
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                aria-label="Describe the problem"
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-neutral-600">
                  Photo (optional){" "}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return setProblemPhoto(null);
                      const reader = new FileReader();
                      reader.onload = () => setProblemPhoto(String(reader.result));
                      reader.readAsDataURL(f);
                    }}
                  />
                </label>
                <button disabled={busy || problem.trim().length < 5} className="rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-40">
                  {busy ? "Asking the seller's agent…" : "Report a problem"}
                </button>
              </div>
            </form>
          </div>
        )}

        {order.status === "CAPTURED" && remaining > 0 && (
          <div className="rounded-xl border border-neutral-200 p-5">
            <p className="mb-3 font-medium">Seller: refund up to {money(remaining, order.currency)}</p>
            <form
              className="flex flex-wrap gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const amountMinor = Math.round(Number(refundPounds) * 100);
                const ok = await act("refund", { amountMinor, requestKey: refundKey.current, approvedBy: "seller" });
                if (ok) refundKey.current = crypto.randomUUID();
              }}
            >
              <input
                className="w-32 rounded-lg border border-neutral-300 px-3 py-2"
                inputMode="decimal"
                value={refundPounds}
                onChange={(e) => setRefundPounds(e.target.value)}
                aria-label="Refund amount"
              />
              <button disabled={busy} className="rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-40">
                Refund
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRefundPounds((remaining / 100).toFixed(2))}
                className="rounded-lg border border-neutral-300 px-4 py-2 disabled:opacity-40"
              >
                Full amount
              </button>
            </form>
          </div>
        )}

        {order.refundedMinor > 0 && (
          <p className="text-neutral-700">Refunded so far: {money(order.refundedMinor, order.currency)}</p>
        )}
        {notice && <p className="text-amber-700">{notice}</p>}
        {error && <p className="text-red-700">{error}</p>}
      </section>

      <PayPalCallLog orderId={order.id} refreshKey={refreshKey} />
    </main>
  );
}
