"use client";

// Mandi Monthly: one handmade piece a month, each from a different artisan,
// as a PayPal subscription (plan, approval, status and cancel all through the
// PayPal Agent Toolkit). Each payment pays that month's artisan.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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
      .catch(() => setError("Couldn't load Mandi Monthly."));
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
    if (!confirm("Cancel Mandi Monthly? You won't be charged again.")) return;
    setBusy(true);
    const res = await fetch("/api/subscriptions", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't cancel. Try again.");
    load();
  }

  const sub = data?.subscription;
  const active = sub && ["ACTIVE", "APPROVED"].includes(sub.status);
  const price = data ? new Intl.NumberFormat("en-US", { style: "currency", currency: data.currency }).format(Number(data.price)) : "";

  return (
    <main className="page">
      <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr]">
        <section className="space-y-6">
          <h1 className="display text-5xl sm:text-6xl">A different artisan every month.</h1>
          <p className="max-w-xl text-lg text-ink-2">
            One handmade piece a month, from a weaver in Varanasi one month and an embroiderer in Kutch the next. Each month&apos;s payment goes to that
            month&apos;s artisan, through PayPal.
          </p>
          <div className="panel max-w-xl space-y-4 p-5 sm:p-6">
            <p className="flex items-baseline gap-2">
              <span className="money text-4xl">{price || "–"}</span>
              <span className="text-ink-3">a month, shipping included. Cancel any time.</span>
            </p>
            {params.get("subscribed") && !active && sub?.status === "APPROVAL_PENDING" && (
              <p className="notice">PayPal hasn&apos;t confirmed it yet. This page updates once it does.</p>
            )}
            {sub && (
              <p className="flex flex-wrap items-center gap-2">
                <span className={`chip ${STATUS[sub.status]?.chip ?? ""}`}>{STATUS[sub.status]?.label ?? sub.status}</span>
                <span className="text-sm text-ink-3">PayPal subscription {sub.id}</span>
              </p>
            )}
            {error && <p className="notice notice-bad">{error}</p>}
            {needsLogin && (
              <p className="notice">
                <Link href="/login?next=/monthly" className="font-semibold underline">
                  Log in as a buyer
                </Link>{" "}
                to subscribe.
              </p>
            )}
            {active ? (
              <button className="btn btn-secondary" disabled={busy} onClick={cancel}>
                Cancel subscription
              </button>
            ) : sub?.status === "APPROVAL_PENDING" && sub.approveUrl ? (
              <a className="btn btn-primary" href={sub.approveUrl}>
                Approve in PayPal
              </a>
            ) : (
              <button className="btn btn-primary" disabled={busy || !data} onClick={subscribe}>
                {busy ? "Opening PayPal…" : "Subscribe with PayPal"}
              </button>
            )}
            <p className="hint">You approve the subscription in PayPal. Mandi never sees your card.</p>
          </div>
        </section>

        {data?.artisan && (
          <section className="panel overflow-hidden" aria-label="This month's artisan">
            {data.artisan.photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.artisan.photoUrl} alt={data.artisan.craft ?? data.artisan.name} className="aspect-[4/3] w-full object-cover" />
            )}
            <div className="space-y-3 p-5 sm:p-6">
              <p className="text-sm text-ink-3">This month&apos;s artisan</p>
              <h2 className="title text-3xl">
                {data.artisan.name}, {data.artisan.city}
              </h2>
              {data.artisan.craft && <p className="text-ink-2">{data.artisan.craft}</p>}
              {data.artisan.quote && <blockquote className="border-l-2 border-haldi pl-4 text-lg">&ldquo;{data.artisan.quote}&rdquo;</blockquote>}
              {data.artisan.photoCredit && <p className="text-xs text-ink-3">Photo: {data.artisan.photoCredit}</p>}
            </div>
          </section>
        )}
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
