"use client";

// Meera's phone: a phone-sized seller view in her language with rupee amounts.
// "Sold — please ship", enter tracking (captures the payment), "Payment received",
// and refund approvals above her cap. Polls so it updates live on camera.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Dashboard } from "@/lib/dashboard/data";
import { inr } from "@/lib/fx";
import { ShippingAddress } from "@/components/ShippingAddress";

type Order = Dashboard["orders"][number];

const T = {
  hi: {
    title: "मेरी बिक्री",
    sold: (amt: string, buyer: string) => `बिक गया! ${amt} में, ${buyer} को।`,
    toShip: "भेजना है",
    done: "पूरा हुआ",
    problem: "शिकायत",
    shipBy: (d: string) => `कृपया ${d} तक भेजें। पैसा PayPal में सुरक्षित है।`,
    tracking: "ट्रैकिंग नंबर",
    shipped: "भेज दिया",
    paid: (amt: string) => `भुगतान मिल गया: ${amt}`,
    refunded: (amt: string) => `रिफंड किया: ${amt}`,
    refundAsk: (amt: string) => `खरीदार ने शिकायत की है। ${amt} रिफंड की मंज़ूरी दें?`,
    approve: "मंज़ूरी दें",
    voided: "होल्ड रद्द हुआ। खरीदार से कोई पैसा नहीं लिया गया।",
    empty: "अभी कोई बिक्री नहीं। जब किसी खरीदार का एजेंट सौदा तय करेगा, वह यहाँ दिखेगी।",
    sending: "भेजा जा रहा है…",
    shipTo: "इस पते पर भेजें",
    extend: "और समय चाहिए? होल्ड बढ़ाएँ",
  },
  en: {
    title: "My sales",
    sold: (amt: string, buyer: string) => `Sold for ${amt} to ${buyer}!`,
    toShip: "To ship",
    done: "Done",
    problem: "Problem",
    shipBy: (d: string) => `Please ship by ${d}. The money is held safely by PayPal.`,
    tracking: "Tracking number",
    shipped: "Shipped",
    paid: (amt: string) => `Payment received: ${amt}`,
    refunded: (amt: string) => `Refunded: ${amt}`,
    refundAsk: (amt: string) => `The buyer reported a problem. Approve a ${amt} refund?`,
    approve: "Approve",
    voided: "Hold released. The buyer was not charged.",
    empty: "No orders yet. When a buyer's agent agrees a deal, it appears here.",
    sending: "Sending…",
    shipTo: "Ship to",
    extend: "Need more time? Extend the hold",
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
  const [fx, setFx] = useState<{ rate: number; date: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/fx")
      .then((r) => r.json())
      .then(setFx)
      .catch(() => setFx(null));
  }, []);

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
      <main className="page-narrow">
        <div className="panel p-6 sm:p-8">
          <h1 className="title text-2xl">{authError}</h1>
          <p className="mt-2 text-ink-2">The phone view shows a seller their sales in their own language.</p>
          <Link href="/login?next=/seller" className="btn btn-primary mt-5">
            Log in as a seller
          </Link>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="flex justify-center px-4 py-10">
        <p className="text-ink-3" role="status">
          Loading…
        </p>
      </main>
    );
  const hi = data.seller.language === "hi";
  const t = hi ? T.hi : T.en;
  const date = (iso: string) => new Date(iso).toLocaleDateString(hi ? "hi-IN" : "en-GB", { day: "numeric", month: "long" });
  const money = (g: number) => `${inr(g, fx?.rate)} (${gbp(g)})`;
  // Unpaid orders (the buyer opened PayPal but never approved) need nothing from the seller.
  // Orders that need the seller (ship, approve a refund) come first.
  const needsSeller = (o: Order) => o.status === "AUTHORIZED" || o.status === "SHIPPED" || o.pendingRefund != null;
  const orders = data.orders
    .filter((o: Order) => o.status !== "CREATED")
    .sort((a: Order, b: Order) => Number(needsSeller(b)) - Number(needsSeller(a)));

  return (
    <main className="flex min-h-[calc(100vh-65px)] justify-center bg-surface px-3 py-6 sm:py-10" lang={hi ? "hi" : "en"}>
      <div className="flex min-h-[640px] w-full max-w-sm flex-col overflow-hidden rounded-[2.5rem] border-[7px] border-ink bg-paper shadow-[0_30px_70px_-30px_rgb(21_25_53/0.55)]">
        <header className="bg-leaf px-5 pb-4 pt-5 text-paper">
          <p className="text-sm opacity-85">Mandi, {data.seller.name}</p>
          <h1 className="title text-3xl">{t.title}</h1>
        </header>
        <ul className="max-h-[70vh] flex-1 space-y-3 overflow-y-auto p-3">
          {orders.length === 0 && <li className="px-2 py-6 text-center text-ink-3">{t.empty}</li>}
          {orders.map((o: Order) => {
            const active = o.status === "AUTHORIZED" || o.status === "SHIPPED";
            return (
              <li
                key={o.id}
                className={`rounded-3xl border p-4 ${active ? "border-haldi bg-haldi-soft" : o.pendingRefund != null ? "border-madder/50" : "border-line bg-raised"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-ink-2">{o.listing}</p>
                  {active ? (
                    <span className="chip chip-agreed shrink-0">{t.toShip}</span>
                  ) : o.pendingRefund != null ? (
                    <span className="chip chip-bad shrink-0">{t.problem}</span>
                  ) : (
                    o.status !== "VOIDED" && <span className="chip chip-safe shrink-0">{t.done}</span>
                  )}
                </div>

                {active && (
                  <>
                    <p className="title mt-2 text-2xl">{t.sold(money(o.amount), o.buyer)}</p>
                    {o.shipBy && <p className="mt-1 text-ink-2">{t.shipBy(date(o.shipBy))}</p>}
                    <div className="mt-3 rounded-2xl bg-raised p-3 text-sm">
                      <ShippingAddress shipping={o.shipping} label={t.shipTo} />
                    </div>
                    <form
                      className="mt-3 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        post(o.id, "ship", { carrier: "India Post", trackingNumber: tracking[o.id] ?? "" });
                      }}
                    >
                      <input
                        className="field min-w-0 flex-1"
                        placeholder={t.tracking}
                        value={tracking[o.id] ?? ""}
                        onChange={(e) => setTracking((m) => ({ ...m, [o.id]: e.target.value }))}
                        aria-label={t.tracking}
                        autoCapitalize="characters"
                      />
                      <button
                        disabled={busy === o.id || (tracking[o.id] ?? "").trim().length < 4}
                        className="btn shrink-0 bg-leaf text-paper hover:opacity-90"
                      >
                        {busy === o.id ? t.sending : t.shipped}
                      </button>
                    </form>
                    <button onClick={() => post(o.id, "extend", {})} disabled={busy === o.id} className="btn btn-quiet btn-sm -ml-2 mt-1 underline">
                      {t.extend}
                    </button>
                  </>
                )}

                {(o.status === "CAPTURED" || o.status === "REFUNDED") && (
                  <>
                    <p className="title mt-2 text-2xl text-leaf">{t.paid(money(o.amount - o.refunded))}</p>
                    {o.refunded > 0 && <p className="mt-1 text-ink-2">{t.refunded(money(o.refunded))}</p>}
                    {o.pendingRefund != null && (
                      <div className="mt-3 rounded-2xl bg-madder-soft p-3">
                        <p className="text-madder">{t.refundAsk(money(o.pendingRefund))}</p>
                        <button
                          disabled={busy === o.id}
                          onClick={() => {
                            const key = keys.current.get(o.id) ?? crypto.randomUUID();
                            keys.current.set(o.id, key);
                            post(o.id, "refund", { amountMinor: Math.round(o.pendingRefund! * 100), requestKey: key, approvedBy: "seller" });
                          }}
                          className="btn btn-primary mt-2 w-full"
                        >
                          {busy === o.id ? t.sending : t.approve}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {o.status === "VOIDED" && <p className="mt-2 text-ink-2">{t.voided}</p>}
              </li>
            );
          })}
        </ul>
        {error && (
          <p role="alert" className="mx-3 mb-2 rounded-xl bg-madder-soft px-3 py-2 text-sm text-madder" lang="en">
            {error}
          </p>
        )}
        {fx?.date && (
          <p className="px-5 pb-4 text-xs text-ink-3" lang="en">
            ₹ at ECB rate {fx.rate.toFixed(2)} ({fx.date})
          </p>
        )}
      </div>
    </main>
  );
}
