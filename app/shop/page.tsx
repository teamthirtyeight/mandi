"use client";

// Buyer request: one sentence → mandate card → confirm once → negotiation room.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
        <div className="h-12 w-2/3 animate-pulse rounded-lg bg-surface" />
        <div className="mt-6 h-32 animate-pulse rounded-[1.25rem] bg-surface" />
      </main>
    );
  if (!me || me.role !== "buyer") {
    return (
      <main className="page-narrow">
        <div className="panel p-8">
          <h1 className="title text-3xl">Send your shopping agent</h1>
          <p className="mt-3 text-ink-2">
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
    <main className="page-narrow space-y-8">
      <header>
        <h1 className="display text-[clamp(2.25rem,5vw,3.25rem)]">What should your agent buy?</h1>
        <p className="mt-3 text-lg text-ink-2">
          Describe it in one sentence, with your budget and when it has to arrive. You&apos;ll check what your agent
          understood before it starts.
        </p>
      </header>

      <form onSubmit={parse} className="panel space-y-4 p-5">
        <label htmlFor="request" className="label">
          Your request
        </label>
        <textarea
          id="request"
          className="field text-lg leading-snug"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Handwoven silk scarf for my mum, under £90, by Dec 20"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="hint">Try:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="chip whitespace-normal text-left hover:bg-indigo-soft hover:text-indigo">
              {ex}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="h-4 w-4 accent-indigo" checked={hostile} onChange={(e) => setHostile(e.target.checked)} />
            Hostile buyer test
          </label>
          <button disabled={busy || text.trim().length < 5} className="btn btn-primary">
            {busy && !mandate ? "Reading your request…" : "Continue"}
          </button>
        </div>
      </form>

      {mandate && (
        <section className="panel overflow-hidden" aria-labelledby="mandate-title">
          <div className="border-b border-line p-5">
            <h2 id="mandate-title" className="title text-xl">
              Check your agent&apos;s instructions
            </h2>
            <p className="hint mt-1">Your agent will stick to these. Edit your sentence above if anything is wrong.</p>
          </div>
          <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-ink-3">Looking for</dt>
              <dd className="font-semibold">{mandate.query}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-3">Most it will pay</dt>
              <dd className="money text-xl">{money(mandate.maxPrice, mandate.currency)}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-3">Must arrive by</dt>
              <dd className="font-semibold">{fmtDate(mandate.deadline)}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-3">Ship to</dt>
              <dd className="font-semibold">{mandate.shipToCountry}</dd>
            </div>
          </dl>
          <div className="space-y-3 border-t border-line bg-surface p-5">
            <p className="text-sm text-ink-2">
              Your agent can&apos;t go over budget or reveal it to sellers. Nothing is paid until you approve one deal.
            </p>
            <button onClick={confirm} disabled={busy} className="btn btn-primary btn-lg w-full">
              {busy ? "Finding sellers…" : "Start negotiating"}
            </button>
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className="notice notice-bad">
          {error}
        </p>
      )}
    </main>
  );
}
