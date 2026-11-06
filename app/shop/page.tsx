"use client";

// Buyer request: one sentence → mandate card → confirm once → negotiation room.
import { useState } from "react";
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

const EXAMPLE = "Handwoven silk scarf for my mum, under £90, by Dec 20";

export default function ShopPage() {
  const router = useRouter();
  const [text, setText] = useState(EXAMPLE);
  const [hostile, setHostile] = useState(false);
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <header>
        <p className="text-sm uppercase tracking-wide text-neutral-500">Sarah · London</p>
        <h1 className="text-3xl font-semibold">What should your agent buy?</h1>
      </header>

      <form onSubmit={parse} className="space-y-3">
        <textarea
          className="w-full rounded-xl border border-neutral-300 p-4 text-lg"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="What you want"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" checked={hostile} onChange={(e) => setHostile(e.target.checked)} />
            Hostile buyer test
          </label>
          <button disabled={busy} className="rounded-lg bg-neutral-900 px-5 py-3 text-white disabled:opacity-40">
            {busy && !mandate ? "Reading…" : "Continue"}
          </button>
        </div>
      </form>

      {mandate && (
        <section className="rounded-xl border border-neutral-200 p-5">
          <p className="mb-3 font-medium">Your agent&apos;s mandate</p>
          <dl className="grid grid-cols-2 gap-3 text-lg">
            <dt className="text-neutral-500">Looking for</dt>
            <dd>{mandate.query}</dd>
            <dt className="text-neutral-500">Budget</dt>
            <dd className="font-semibold">{money(mandate.maxPrice, mandate.currency)} max</dd>
            <dt className="text-neutral-500">Arrives by</dt>
            <dd>{new Date(mandate.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</dd>
            <dt className="text-neutral-500">Ship to</dt>
            <dd>{mandate.shipToCountry}</dd>
          </dl>
          <p className="mt-4 text-sm text-neutral-500">
            Your agent can&apos;t go over budget, and nothing is paid until you approve one deal.
          </p>
          <button
            onClick={confirm}
            disabled={busy}
            className="mt-4 w-full rounded-lg bg-neutral-900 px-5 py-3 text-white disabled:opacity-40"
          >
            {busy ? "Finding sellers…" : "Confirm and start negotiating"}
          </button>
        </section>
      )}

      {error && <p className="text-red-700">{error}</p>}
    </main>
  );
}
