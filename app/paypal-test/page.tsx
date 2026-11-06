"use client";

// Day 1 exit check: approve a £72 test deal in the PayPal sandbox popup and
// see it authorized (money held). Then continue on the order tracker.
import { useRef, useState } from "react";
import Link from "next/link";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { PayPalCallLog } from "@/components/PayPalCallLog";

type Result =
  | { kind: "idle" }
  | { kind: "held"; authorizationId: string; orderId: string | null }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export default function PaypalTestPage() {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  const requestKey = useRef<string>(crypto.randomUUID());
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  if (!clientId) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-lg">Set NEXT_PUBLIC_PAYPAL_CLIENT_ID in .env.local to load the PayPal button.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-5xl gap-8 p-8 md:grid-cols-[1fr_1fr]">
      <section className="space-y-6">
        <header>
          <p className="text-sm uppercase tracking-wide text-neutral-500">PayPal sandbox test</p>
          <h1 className="text-3xl font-semibold">Approve a test deal</h1>
        </header>

        <div className="rounded-xl border border-neutral-200 p-5">
          <p className="text-neutral-600">Meera · Varanasi</p>
          <p className="text-lg font-medium">Handwoven Banarasi silk scarf, rose and gold</p>
          <p className="mt-2 text-[28px] font-semibold">£72.00</p>
        </div>

        <PayPalScriptProvider options={{ clientId, intent: "authorize", currency: "GBP" }}>
          <PayPalButtons
            style={{ layout: "vertical", label: "pay" }}
            createOrder={async () => {
              setResult({ kind: "idle" });
              const res = await fetch("/api/paypal/test-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestKey: requestKey.current }),
              });
              const body = await res.json();
              refresh();
              if (!res.ok) throw new Error(body.error ?? "Could not create order");
              return body.id;
            }}
            onApprove={async (data) => {
              const res = await fetch(`/api/paypal/orders/${data.orderID}/authorize`, { method: "POST" });
              const body = await res.json();
              // Fresh key so the next test creates a new order.
              requestKey.current = crypto.randomUUID();
              refresh();
              if (!res.ok) {
                setResult({ kind: "error", message: body.error ?? "Authorize failed" });
                return;
              }
              setResult({ kind: "held", authorizationId: body.authorizationId, orderId: body.orderId });
            }}
            onCancel={() => {
              setResult({ kind: "cancelled" });
              refresh();
            }}
            onError={(err) => setResult({ kind: "error", message: String(err) })}
          />
        </PayPalScriptProvider>

        {result.kind === "held" && (
          <div className="rounded-xl border border-green-300 bg-green-50 p-5">
            <p className="text-xl font-semibold text-green-900">£72 held — ship within 3 days</p>
            <p className="mt-1 font-mono text-sm text-green-900">Authorization {result.authorizationId}</p>
            {result.orderId && (
              <Link href={`/order/${result.orderId}`} className="mt-3 inline-block font-medium text-green-900 underline">
                Open the order tracker →
              </Link>
            )}
          </div>
        )}
        {result.kind === "cancelled" && (
          <p className="text-neutral-600">Popup closed. The order stays in CREATED; try again any time.</p>
        )}
        {result.kind === "error" && <p className="text-red-700">{result.message}</p>}
      </section>

      <PayPalCallLog refreshKey={refreshKey} />
    </main>
  );
}
