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
      <main className="page-narrow">
        <p className="notice">Set NEXT_PUBLIC_PAYPAL_CLIENT_ID in .env.local to load the PayPal button.</p>
      </main>
    );
  }

  return (
    <main className="page grid gap-8 md:grid-cols-[1fr_1fr]">
      <section className="space-y-6">
        <header>
          <h1 className="display text-4xl">Approve a test deal</h1>
          <p className="mt-2 text-ink-2">A developer check of the PayPal sandbox: approve £72 and see it held, without running a negotiation.</p>
        </header>

        <div className="panel p-5">
          <p className="text-ink-3">Meera, Varanasi</p>
          <p className="text-lg font-semibold">Handwoven Banarasi silk scarf, rose and gold</p>
          <p className="money mt-2 text-3xl">£72.00</p>
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
              // The popup was closed: the next click should start a new order.
              requestKey.current = crypto.randomUUID();
              setResult({ kind: "cancelled" });
              refresh();
            }}
            onError={(err) => {
              requestKey.current = crypto.randomUUID();
              setResult({ kind: "error", message: String(err) });
            }}
          />
        </PayPalScriptProvider>

        {result.kind === "held" && (
          <div className="notice notice-safe p-5" role="status">
            <p className="title text-xl">£72 held. Ship within 3 days.</p>
            <p className="mt-1 text-sm">Authorization {result.authorizationId}</p>
            {result.orderId && (
              <Link href={`/order/${result.orderId}`} className="mt-3 inline-block font-semibold underline">
                Open the order tracker
              </Link>
            )}
          </div>
        )}
        {result.kind === "cancelled" && (
          <p className="notice text-sm" role="status">PayPal was closed before approving. Nothing was held; try again any time.</p>
        )}
        {result.kind === "error" && (
          <p role="alert" className="notice notice-bad text-sm">
            {result.message}
          </p>
        )}
      </section>

      <div className="panel overflow-hidden">
        <PayPalCallLog refreshKey={refreshKey} />
      </div>
    </main>
  );
}
