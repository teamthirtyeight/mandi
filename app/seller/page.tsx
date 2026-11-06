"use client";

// Meera's phone: a phone-sized seller view in her language with rupee amounts.
// "Sold — please ship", enter tracking (captures the payment), "Payment received",
// and refund approvals above her cap. Polls so it updates live on camera.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Dashboard } from "@/lib/dashboard/data";
import { inr } from "@/lib/fx";

type Order = Dashboard["orders"][number];

const T = {
  hi: {
    title: "मेरी बिक्री",
    sold: (amt: string, buyer: string) => `बिक गया! ${amt} में, ${buyer} को।`,
    shipBy: (d: string) => `कृपया ${d} तक भेजें। पैसा PayPal में सुरक्षित है।`,
    tracking: "ट्रैकिंग नंबर",
    shipped: "भेज दिया",
    paid: (amt: string) => `भुगतान मिल गया: ${amt}`,
    refunded: (amt: string) => `रिफंड किया: ${amt}`,
    refundAsk: (amt: string) => `खरीदार ने शिकायत की है। ${amt} रिफंड की मंज़ूरी दें?`,
    approve: "मंज़ूरी दें",
    voided: "होल्ड रद्द हुआ। खरीदार से कोई पैसा नहीं लिया गया।",
    empty: "अभी कोई बिक्री नहीं।",
    sending: "भेजा जा रहा है…",
  },
  en: {
    title: "My sales",
    sold: (amt: string, buyer: string) => `Sold for ${amt} to ${buyer}!`,
    shipBy: (d: string) => `Please ship by ${d}. The money is held safely by PayPal.`,
    tracking: "Tracking number",
    shipped: "Shipped",
    paid: (amt: string) => `Payment received: ${amt}`,
    refunded: (amt: string) => `Refunded: ${amt}`,
    refundAsk: (amt: string) => `The buyer reported a problem. Approve a ${amt} refund?`,
    approve: "Approve",
    voided: "Hold released. The buyer was not charged.",
    empty: "No sales yet.",
    sending: "Sending…",
  },
};

const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export default function SellerPhone() {
  const [authError, setAuthError] = useState<string | null>(null);
  const [data, setData] = useState<Dashboard | null>(null);
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    const res = await fetch("/api/dashboard", { cache: "no-store" });
    if (res.ok) setData(await res.json());
    else if (res.status === 401 || res.status === 403) setAuthError((await res.json()).error);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  async function post(orderId: string, path: string, body: unknown) {
    setBusy(orderId);
    setError(null);
    const res = await fetch(`/api/orders/${orderId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) setError(json.error ?? "Failed");
    await load();
  }

  if (authError)
    return (
      <main className="p-8">
        {authError}.{" "}
        <Link href="/login?next=/seller" className="underline">
          Log in as a seller
        </Link>
      </main>
    );
  if (!data) return <main className="p-6 text-neutral-500">…</main>;
  const t = data.seller.language === "hi" ? T.hi : T.en;
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(data.seller.language === "hi" ? "hi-IN" : "en-GB", { day: "numeric", month: "long" });
  const money = (g: number) => `${inr(g)} (${gbp(g)})`;

  return (
    <main className="flex justify-center bg-neutral-100 px-4 py-8">
      <div className="w-full max-w-sm overflow-hidden rounded-[2.5rem] border-8 border-neutral-900 bg-white shadow-xl">
        <header className="bg-green-700 px-5 py-4 text-white">
          <p className="text-sm opacity-80">Mandi · {data.seller.name}</p>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
        </header>
        <ul className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
          {data.orders.length === 0 && <li className="text-neutral-500">{t.empty}</li>}
          {data.orders.map((o: Order) => (
            <li key={o.id} className="rounded-2xl border border-neutral-200 p-4">
              <p className="text-sm text-neutral-500">{o.listing}</p>

              {(o.status === "AUTHORIZED" || o.status === "SHIPPED") && (
                <>
                  <p className="mt-1 text-xl font-semibold">{t.sold(money(o.amount), o.buyer)}</p>
                  {o.shipBy && <p className="mt-1 text-neutral-700">{t.shipBy(date(o.shipBy))}</p>}
                  <form
                    className="mt-3 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      post(o.id, "ship", { carrier: "India Post", trackingNumber: tracking[o.id] ?? "" });
                    }}
                  >
                    <input
                      className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2"
                      placeholder={t.tracking}
                      value={tracking[o.id] ?? ""}
                      onChange={(e) => setTracking((m) => ({ ...m, [o.id]: e.target.value }))}
                      aria-label={t.tracking}
                    />
                    <button
                      disabled={busy === o.id || (tracking[o.id] ?? "").trim().length < 4}
                      className="rounded-lg bg-green-700 px-4 py-2 text-white disabled:opacity-40"
                    >
                      {busy === o.id ? t.sending : t.shipped}
                    </button>
                  </form>
                </>
              )}

              {(o.status === "CAPTURED" || o.status === "REFUNDED") && (
                <>
                  <p className="mt-1 text-xl font-semibold text-green-800">{t.paid(money(o.amount - o.refunded))}</p>
                  {o.refunded > 0 && <p className="text-neutral-700">{t.refunded(money(o.refunded))}</p>}
                  {o.pendingRefund != null && (
                    <div className="mt-3 rounded-xl bg-amber-50 p-3">
                      <p className="text-amber-900">{t.refundAsk(money(o.pendingRefund))}</p>
                      <button
                        disabled={busy === o.id}
                        onClick={() => {
                          const key = keys.current.get(o.id) ?? crypto.randomUUID();
                          keys.current.set(o.id, key);
                          post(o.id, "refund", { amountMinor: Math.round(o.pendingRefund! * 100), requestKey: key, approvedBy: "seller" });
                        }}
                        className="mt-2 rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-40"
                      >
                        {t.approve}
                      </button>
                    </div>
                  )}
                </>
              )}

              {o.status === "VOIDED" && <p className="mt-1 text-neutral-700">{t.voided}</p>}
            </li>
          ))}
        </ul>
        {error && <p className="px-4 pb-4 text-sm text-red-700">{error}</p>}
      </div>
    </main>
  );
}
