"use client";

// Meera's phone: a phone-sized seller view in her language with rupee amounts.
// "Sold — please ship", enter tracking (captures the payment), "Payment received",
// and refund approvals above her cap. Polls so it updates live on camera.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Dashboard } from "@/lib/dashboard/data";
import { inr } from "@/lib/fx";
import { ShippingAddress } from "@/components/ShippingAddress";
import { BellIcon, CheckIcon, PackageIcon, RefundIcon } from "@/components/Icons";
import { LANGUAGE_INFO, SELLER_STRINGS, sellerLanguage } from "@/lib/i18n/seller";

type Order = Dashboard["orders"][number];

const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

const CloseIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
  </svg>
);

// The phone shell: full width on a phone, a device frame on larger screens.
function PhoneShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-sm flex-col overflow-hidden bg-paper sm:min-h-[640px] sm:rounded-[2.25rem] sm:border-[6px] sm:border-ink sm:shadow-[var(--shadow-lg)]">
      {children}
    </div>
  );
}

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
          <span className="icon-tile" aria-hidden="true">
            <BellIcon size={18} />
          </span>
          <h1 className="title mt-4 text-2xl">{authError}</h1>
          <p className="mt-2 text-ink-2">The phone view shows a seller their sales in their own language.</p>
          <Link href="/login?next=/seller" className="btn btn-primary mt-6">
            Log in as a seller
          </Link>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="flex min-h-[calc(100vh-65px)] justify-center bg-surface sm:px-3 sm:py-10" aria-busy="true">
        <p className="sr-only" role="status">
          Loading…
        </p>
        <PhoneShell>
          <div className="animate-pulse" aria-hidden="true">
            <div className="space-y-2 border-b border-line px-5 pb-5 pt-6">
              <div className="h-3 w-28 rounded bg-surface" />
              <div className="h-7 w-44 rounded-md bg-surface" />
            </div>
            <div className="space-y-3 p-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3 rounded-[0.875rem] border border-line p-4">
                  <div className="h-9 w-9 shrink-0 rounded-[0.625rem] bg-surface" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-24 rounded bg-surface" />
                    <div className="h-5 w-full rounded bg-surface" />
                    <div className="h-3 w-2/3 rounded bg-surface" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </PhoneShell>
      </main>
    );
  const lang = sellerLanguage(data.seller.language);
  const t = SELLER_STRINGS[lang];
  const date = (iso: string) => new Date(iso).toLocaleDateString(LANGUAGE_INFO[lang].locale, { day: "numeric", month: "long" });
  const money = (g: number) => `${inr(g, fx?.rate)} (${gbp(g)})`;
  // Unpaid orders (the buyer opened PayPal but never approved) need nothing from the seller.
  // Orders that need the seller (ship, approve a refund) come first.
  const needsSeller = (o: Order) => o.status === "AUTHORIZED" || o.status === "SHIPPED" || o.pendingRefund != null;
  const orders = data.orders
    .filter((o: Order) => o.status !== "CREATED")
    .sort((a: Order, b: Order) => Number(needsSeller(b)) - Number(needsSeller(a)));
  const waiting = orders.filter(needsSeller).length;

  return (
    <main className="flex min-h-[calc(100vh-65px)] justify-center bg-surface sm:px-3 sm:py-10" lang={lang}>
      <PhoneShell>
        <header className="border-b border-line bg-raised px-5 pb-4 pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-xs font-medium text-ink-3" lang="en">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo text-[0.6875rem] font-semibold text-on-indigo" aria-hidden="true">
                M
              </span>
              <span className="truncate">Mandix, {data.seller.name}</span>
            </p>
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-2" lang="en">
              <BellIcon size={20} />
              {waiting > 0 && (
                <span className="num absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-madder px-1 text-[0.625rem] font-semibold text-paper">
                  {waiting}
                </span>
              )}
              <span className="sr-only">{waiting} need your attention</span>
            </span>
          </div>
          <h1 className="title mt-3 text-2xl">{t.title}</h1>
          {lang !== "en" && (
            <p className="mt-1 text-xs text-ink-3" lang="en">
              Alerts in {LANGUAGE_INFO[lang].name}
            </p>
          )}
        </header>

        <ul className="flex-1 space-y-2.5 overflow-y-auto bg-surface p-3 sm:max-h-[70vh]">
          {orders.length === 0 && (
            <li className="flex flex-col items-center px-4 py-14 text-center">
              <span className="icon-tile bg-raised text-ink-3 shadow-[var(--shadow-xs)]" aria-hidden="true">
                <BellIcon size={18} />
              </span>
              <p className="mt-3 text-sm text-ink-2">{t.empty}</p>
            </li>
          )}
          {orders.map((o: Order) => {
            const active = o.status === "AUTHORIZED" || o.status === "SHIPPED";
            const refund = o.pendingRefund != null;
            const tile = active
              ? { icon: <PackageIcon size={18} />, cls: "bg-haldi-soft text-haldi-ink" }
              : refund
                ? { icon: <RefundIcon size={18} />, cls: "bg-madder-soft text-madder" }
                : o.status === "VOIDED"
                  ? { icon: <CloseIcon size={18} />, cls: "bg-surface text-ink-3" }
                  : { icon: <CheckIcon size={18} />, cls: "bg-leaf-soft text-leaf" };
            return (
              <li
                key={o.id}
                className={`chat-line rounded-[0.875rem] border bg-raised p-4 shadow-[var(--shadow-xs)] ${
                  active ? "border-haldi/60" : refund ? "border-madder/40" : "border-line"
                }`}
              >
                <div className="flex gap-3">
                  <span className={`icon-tile ${tile.cls}`} aria-hidden="true">
                    {tile.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-medium text-ink-3">{o.listing}</p>
                      {active ? (
                        <span className="chip chip-agreed shrink-0">{t.toShip}</span>
                      ) : refund ? (
                        <span className="chip chip-bad shrink-0">{t.problem}</span>
                      ) : (
                        o.status !== "VOIDED" && <span className="chip chip-safe shrink-0">{t.done}</span>
                      )}
                    </div>

                    {active && <p className="title mt-1 text-lg">{t.sold(money(o.amount), o.buyer)}</p>}
                    {active && o.shipBy && <p className="mt-0.5 text-sm text-ink-2">{t.shipBy(date(o.shipBy))}</p>}

                    {(o.status === "CAPTURED" || o.status === "REFUNDED") && (
                      <>
                        <p className="title mt-1 text-lg text-leaf">{t.paid(money(o.amount - o.refunded))}</p>
                        {o.refunded > 0 && <p className="mt-0.5 text-sm text-ink-2">{t.refunded(money(o.refunded))}</p>}
                      </>
                    )}

                    {o.status === "VOIDED" && <p className="mt-1 text-sm text-ink-2">{t.voided}</p>}
                  </div>
                </div>

                {active && (
                  <div className="mt-3 space-y-3">
                    {o.shipping && (
                      <div className="well p-3 text-sm">
                        <ShippingAddress shipping={o.shipping} label={t.shipTo} />
                      </div>
                    )}
                    <form
                      className="flex gap-2"
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
                    <button
                      onClick={() => post(o.id, "extend", {})}
                      disabled={busy === o.id}
                      className="btn btn-quiet btn-sm -ml-2.5 min-h-10 text-indigo"
                    >
                      {t.extend}
                    </button>
                  </div>
                )}

                {(o.status === "CAPTURED" || o.status === "REFUNDED") && refund && (
                  <div className="mt-3 rounded-[0.625rem] border border-madder/20 bg-madder-soft p-3">
                    <p className="text-sm text-madder">{t.refundAsk(money(o.pendingRefund!))}</p>
                    <button
                      disabled={busy === o.id}
                      onClick={() => {
                        const key = keys.current.get(o.id) ?? crypto.randomUUID();
                        keys.current.set(o.id, key);
                        post(o.id, "refund", { amountMinor: Math.round(o.pendingRefund! * 100), requestKey: key, approvedBy: "seller" });
                      }}
                      className="btn btn-primary mt-2.5 w-full"
                    >
                      {busy === o.id ? t.sending : t.approve}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {error && (
          <p role="alert" className="notice notice-bad mx-3 my-2 text-sm" lang="en">
            {error}
          </p>
        )}
        {fx?.date && (
          <p className="border-t border-line bg-raised px-5 py-3 text-xs text-ink-3" lang="en">
            Rupee amounts use the European Central Bank rate of <span className="num">{fx.rate.toFixed(2)}</span> ({fx.date}).
          </p>
        )}
      </PhoneShell>
    </main>
  );
}
