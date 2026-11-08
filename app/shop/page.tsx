"use client";

// Buyer request: one sentence → mandate card → confirm once → negotiation room.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, LockIcon, ShieldIcon, SparkIcon } from "@/components/Icons";

interface Mandate {
  id: string;
  query: string;
  maxPrice: number;
  currency: string;
  deadline: string;
  shipToCountry: string;
  hostile: boolean;
}

const EXAMPLES = [
  "Handwoven silk scarf for my mum, under £90, by Dec 20",
  "Embroidered wool shawl, under £200, by 4 December",
  "Block-printed cotton tablecloth, under £60",
];

export default function ShopPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [hostile, setHostile] = useState(false);
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ name: string; role: string } | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((b) => setMe(b.user));
  }, []);

  const money = (n: number, c: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(n);

  async function parse(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMandate(null);
    const res = await fetch("/api/mandates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestText: text, hostile }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error);
    setMandate(body);
  }

  async function confirm() {
    if (!mandate) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/mandates/${mandate.id}/confirm`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setBusy(false);
      return setError(body.error);
    }
    router.push(`/deal/${mandate.id}`);
  }

  if (me === undefined)
    return (
      <main className="page-narrow" aria-busy="true">
        <span className="sr-only">Loading</span>
        <div className="h-4 w-24 animate-pulse rounded bg-surface" />
        <div className="mt-4 h-10 w-3/4 animate-pulse rounded-lg bg-surface" />
        <div className="mt-3 h-5 w-full max-w-md animate-pulse rounded bg-surface" />
        <div className="panel mt-8 overflow-hidden">
          <div className="space-y-3 p-5">
            <div className="h-4 w-28 animate-pulse rounded bg-surface" />
            <div className="h-16 w-full animate-pulse rounded-lg bg-surface" />
          </div>
          <div className="flex items-center justify-between border-t border-line bg-surface px-5 py-3">
            <div className="h-4 w-32 animate-pulse rounded bg-line" />
            <div className="h-10 w-28 animate-pulse rounded-lg bg-line" />
          </div>
        </div>
      </main>
    );
  if (!me || me.role !== "buyer") {
    return (
      <main className="page-narrow">
        <div className="panel p-6 sm:p-8">
          <span className="icon-tile">
            <SparkIcon />
          </span>
          <h1 className="title mt-4 text-2xl">Send your shopping agent</h1>
          <p className="mt-2 text-ink-2">
            {me ? "This needs a buyer account. " : ""}Log in with a buyer account, or try the one-click demo as Sarah from the
            home page.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/login?next=/shop" className="btn btn-primary">
              Log in
            </Link>
            <Link href="/signup" className="btn btn-secondary">
              Create an account
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="page-narrow space-y-6">
      <header className="pb-2">
        <p className="eyebrow flex items-center gap-1.5">
          <SparkIcon size={14} className="text-indigo" />
          New request
        </p>
        <h1 className="display mt-3 text-[clamp(2rem,5vw,2.75rem)]">What should your agent buy?</h1>
        <p className="lede mt-3 max-w-xl">
          Describe it in one sentence, with your budget and when it has to arrive. You&apos;ll check what your agent
          understood before it starts.
        </p>
      </header>

      <form
        onSubmit={parse}
        className="panel overflow-hidden shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] focus-within:border-indigo focus-within:shadow-[0_0_0_3px_var(--indigo-soft)]"
      >
        <div className="px-4 pt-4 sm:px-5">
          <label htmlFor="request" className="label text-ink-2">
            Your request
          </label>
          <textarea
            id="request"
            className="block w-full resize-none bg-transparent pb-3 text-lg leading-snug text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Handwoven silk scarf for my mum, under £90, by Dec 20"
            // The whole composer shows the focus ring, so the textarea needs none of its own.
            style={{ outline: "none" }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-2.5 sm:px-5">
          <label className="-ml-1 flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-1 text-sm text-ink-2 hover:text-ink">
            <input type="checkbox" className="h-4 w-4 accent-indigo" checked={hostile} onChange={(e) => setHostile(e.target.checked)} />
            Hostile buyer test
          </label>
          <button disabled={busy || text.trim().length < 5} className="btn btn-primary">
            {busy && !mandate ? "Reading your request…" : "Continue"}
            {!(busy && !mandate) && <ArrowRightIcon size={16} />}
          </button>
        </div>
      </form>

      <div>
        <p className="eyebrow">Try an example</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="inline-flex min-h-10 max-w-full items-center rounded-lg border border-line bg-raised px-3 py-2 text-left text-sm text-ink-2 shadow-[var(--shadow-xs)] transition-colors hover:border-line-strong hover:bg-surface hover:text-ink"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {mandate && (
        <section className="panel panel-raised overflow-hidden" aria-labelledby="mandate-title">
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <span className="icon-tile">
              <ShieldIcon />
            </span>
            <div className="min-w-0">
              <h2 id="mandate-title" className="title text-lg">
                Check your agent&apos;s instructions
              </h2>
              <p className="hint mt-0.5">Your agent will stick to these. Edit your sentence above if anything is wrong.</p>
            </div>
          </div>
          <dl className="divide-y divide-line px-5">
            <div className="grid gap-1 py-3.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className="text-sm text-ink-3">Looking for</dt>
              <dd className="font-medium text-ink">{mandate.query}</dd>
            </div>
            <div className="grid gap-1 py-3.5 sm:grid-cols-[10rem_1fr] sm:items-baseline sm:gap-4">
              <dt className="text-sm text-ink-3">Most it will pay</dt>
              <dd className="money text-xl text-ink">{money(mandate.maxPrice, mandate.currency)}</dd>
            </div>
            <div className="grid gap-1 py-3.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className="text-sm text-ink-3">Must arrive by</dt>
              <dd className="num font-medium text-ink">{fmtDate(mandate.deadline)}</dd>
            </div>
            <div className="grid gap-1 py-3.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className="text-sm text-ink-3">Ship to</dt>
              <dd className="font-medium text-ink">{mandate.shipToCountry}</dd>
            </div>
          </dl>
          <div className="space-y-4 border-t border-line bg-surface px-5 py-4">
            <p className="flex items-start gap-2 text-sm text-ink-2">
              <LockIcon size={16} className="mt-0.5 shrink-0 text-leaf" />
              <span>Your agent can&apos;t go over budget or reveal it to sellers. Nothing is paid until you approve one deal.</span>
            </p>
            <button onClick={confirm} disabled={busy} className="btn btn-primary btn-lg w-full">
              {busy ? "Finding sellers…" : "Start negotiating"}
              {!busy && <ArrowRightIcon size={16} />}
            </button>
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className="notice notice-bad text-sm">
          {error}
        </p>
      )}
    </main>
  );
}
