"use client";

// Mandix Monthly: one handmade piece a month, each from a different artisan,
// as a PayPal subscription (plan, approval, status and cancel all through the
// PayPal Agent Toolkit). Each payment pays that month's artisan.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckIcon, LockIcon, PackageIcon, ShieldIcon } from "@/components/Icons";

interface Data {
  price: string;
  currency: string;
  artisan: { name: string; city: string; craft: string | null; quote: string | null; photoUrl: string | null; photoCredit: string | null } | null;
  subscription: { id: string; status: string; approveUrl: string | null } | null;
}

const STATUS: Record<string, { label: string; chip: string }> = {
  ACTIVE: { label: "Active", chip: "chip-safe" },
  APPROVAL_PENDING: { label: "Waiting for your approval in PayPal", chip: "chip-agreed" },
  APPROVED: { label: "Approved, starting", chip: "chip-progress" },
  SUSPENDED: { label: "Paused by PayPal", chip: "chip-bad" },
  CANCELLED: { label: "Cancelled", chip: "" },
  EXPIRED: { label: "Ended", chip: "" },
};

const INCLUDED = [
  { icon: PackageIcon, text: "One handmade piece every month" },
  { icon: CheckIcon, text: "A different artisan each time" },
  { icon: ShieldIcon, text: "Each payment goes to that month's artisan" },
];

function Monthly() {
  const params = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  const load = () =>
    fetch("/api/subscriptions")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("Couldn't load Mandix Monthly."));
  useEffect(() => {
    load();
  }, []);

  async function subscribe() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/subscriptions", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      setBusy(false);
      return setNeedsLogin(true);
    }
    if (!res.ok || !body.approveUrl) {
      setBusy(false);
      return setError(body.error ?? "PayPal couldn't start the subscription. Try again in a minute.");
    }
    window.location.href = body.approveUrl;
  }

  async function cancel() {
    if (!confirm("Cancel Mandix Monthly? You won't be charged again.")) return;
    setBusy(true);
    const res = await fetch("/api/subscriptions", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't cancel. Try again.");
    load();
  }

  const sub = data?.subscription;
  const active = sub && ["ACTIVE", "APPROVED"].includes(sub.status);
  const price = data ? new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency }).format(Number(data.price)) : "";
  const loading = !data && !error;

  return (
    <main className="page">
      {/* Intro */}
      <header className="max-w-3xl">
        <p className="eyebrow">Mandix Monthly</p>
        <h1 className="display mt-3 text-[clamp(2.25rem,5.4vw,3.75rem)]">A different artisan every month.</h1>
        <p className="lede mt-5 max-w-xl">
          One handmade piece a month, from a weaver in Varanasi one month and an embroiderer in Kutch the next. Each month&apos;s payment goes to that
          month&apos;s artisan, through PayPal.
        </p>
      </header>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-12">
        {/* Plan card: first on phones, sticky on the right on desktop */}
        <section className="panel panel-raised overflow-hidden lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1" aria-labelledby="plan-heading">
          <div className="border-b border-line px-5 py-5 sm:px-6">
            <h2 id="plan-heading" className="text-sm font-semibold text-ink-2">
              Monthly subscription
            </h2>
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {loading ? (
                <span className="inline-block h-10 w-28 animate-pulse rounded-lg bg-surface" aria-hidden="true" />
              ) : (
                <span className="money text-[2.5rem] leading-none">{price || "–"}</span>
              )}
              <span className="text-sm text-ink-3">a month, shipping included. Cancel any time.</span>
            </p>
          </div>

          <div className="space-y-4 px-5 py-5 sm:px-6">
            <ul className="space-y-2.5 text-sm text-ink-2">
              {INCLUDED.map(({ icon: IconComponent, text }) => (
                <li key={text} className="flex items-start gap-2.5">
                  <IconComponent size={16} className="mt-0.5 shrink-0 text-leaf" />
                  {text}
                </li>
              ))}
            </ul>

            {params.get("subscribed") && !active && sub?.status === "APPROVAL_PENDING" && (
              <p className="notice text-sm">PayPal hasn&apos;t confirmed it yet. This page updates once it does.</p>
            )}
            {sub && (
              <div className="well space-y-1.5 p-3.5">
                <p className="stat-label">Your subscription</p>
                <p className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${STATUS[sub.status]?.chip ?? ""}`}>{STATUS[sub.status]?.label ?? sub.status}</span>
                </p>
                <p className="num break-all text-xs text-ink-3">PayPal subscription {sub.id}</p>
              </div>
            )}
            {error && (
              <p role="alert" className="notice notice-bad text-sm">
                {error}
              </p>
            )}
            {needsLogin && (
              <p className="notice text-sm">
                <Link href="/login?next=/monthly" className="font-semibold underline">
                  Log in as a buyer
                </Link>{" "}
                to subscribe.
              </p>
            )}
            {active ? (
              <button className="btn btn-secondary btn-lg w-full" disabled={busy} onClick={cancel}>
                Cancel subscription
              </button>
            ) : sub?.status === "APPROVAL_PENDING" && sub.approveUrl ? (
              <a className="btn btn-primary btn-lg w-full" href={sub.approveUrl}>
                Approve in PayPal
              </a>
            ) : (
              <button className="btn btn-primary btn-lg w-full" disabled={busy || !data} onClick={subscribe}>
                {busy ? "Opening PayPal…" : "Subscribe with PayPal"}
              </button>
            )}
          </div>

          <p className="flex items-start gap-2.5 border-t border-line bg-surface px-5 py-3.5 text-xs text-ink-3 sm:px-6">
            <LockIcon size={15} className="mt-px shrink-0 text-leaf" />
            You approve the subscription in PayPal. Mandix never sees your card.
          </p>
        </section>

        {/* This month's artisan */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          {loading ? (
            <div className="panel overflow-hidden" aria-busy="true">
              <p className="sr-only" role="status">
                Loading this month&apos;s artisan
              </p>
              <div className="aspect-[16/10] w-full animate-pulse bg-surface" />
              <div className="space-y-3 p-5 sm:p-8">
                <div className="h-3 w-32 animate-pulse rounded bg-surface" />
                <div className="h-8 w-2/3 animate-pulse rounded-lg bg-surface" />
                <div className="h-4 w-1/3 animate-pulse rounded bg-surface" />
              </div>
            </div>
          ) : data?.artisan ? (
            <section className="panel overflow-hidden" aria-label="This month's artisan">
              {data.artisan.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.artisan.photoUrl} alt={data.artisan.craft ?? data.artisan.name} className="aspect-[16/10] w-full bg-surface object-cover" />
              )}
              <div className="p-5 sm:p-8">
                <p className="eyebrow">This month&apos;s artisan</p>
                <h2 className="title mt-2 text-2xl sm:text-3xl">
                  {data.artisan.name}, {data.artisan.city}
                </h2>
                {data.artisan.craft && <p className="chip chip-agreed mt-3">{data.artisan.craft}</p>}
                {data.artisan.quote && (
                  <blockquote className="well mt-6 border-l-[3px] border-haldi p-4 sm:p-5">
                    <p className="title text-lg sm:text-xl">&ldquo;{data.artisan.quote}&rdquo;</p>
                    <footer className="hint mt-1.5">{data.artisan.name}</footer>
                  </blockquote>
                )}
                {data.artisan.photoCredit && <p className="mt-6 text-xs text-ink-3">Photo: {data.artisan.photoCredit}</p>}
              </div>
            </section>
          ) : !data ? (
            <div className="well flex flex-col items-center px-6 py-12 text-center">
              <span className="icon-tile h-12 w-12">
                <PackageIcon size={22} />
              </span>
              <p className="title mt-4 text-lg">We couldn&apos;t load this month&apos;s artisan</p>
              <p className="mt-1 text-sm text-ink-2">Refresh the page to try again.</p>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function MonthlyPage() {
  return (
    <Suspense>
      <Monthly />
    </Suspense>
  );
}
