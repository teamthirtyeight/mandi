"use client";

// "My agent": how the signed-in seller's or buyer's agent behaves. Sellers set
// how firmly it holds the price, what it may offer, and the profile it argues
// from; buyers set how hard it haggles, how many sellers it talks to, and what
// matters most when it recommends a deal.
import { useEffect, useState } from "react";
import Link from "next/link";

type SellerSettings = {
  agentStyle: "firm" | "balanced" | "flexible";
  offerGiftWrap: boolean;
  offerBundles: boolean;
  maxBundleDiscountPct: number;
  agentNote: string | null;
};
type SellerProfile = { story: string; language: "en" | "hi"; shipByDays: number; transitDays: number; refundCap: number };
type BuyerSettings = {
  agentStyle: "patient" | "balanced" | "quick";
  maxSellers: number;
  acceptBundles: boolean;
  priority: "price" | "balanced" | "delivery";
};
type Data =
  | { role: "seller"; name: string; settings: SellerSettings; profile: SellerProfile }
  | { role: "buyer"; name: string; settings: BuyerSettings };

const SELLER_STYLES = [
  { v: "firm", label: "Firm", hint: "Small concessions; adds value before cutting price" },
  { v: "balanced", label: "Balanced", hint: "Concedes in shrinking steps" },
  { v: "flexible", label: "Flexible", hint: "Moves quickly to close the sale" },
] as const;
const BUYER_STYLES = [
  { v: "patient", label: "Patient", hint: "Small steps; uses every round to get the best price" },
  { v: "balanced", label: "Balanced", hint: "Concedes slowly" },
  { v: "quick", label: "Quick", hint: "Agrees on a fair price early" },
] as const;
const PRIORITIES = [
  { v: "price", label: "Lowest price" },
  { v: "balanced", label: "Balanced" },
  { v: "delivery", label: "Fastest delivery" },
] as const;

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { v: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <button
          type="button"
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`rounded-xl border p-3 text-left ${value === o.v ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
        >
          <p className="font-medium">{o.label}</p>
          {o.hint && <p className={`text-xs ${value === o.v ? "text-neutral-300" : "text-neutral-500"}`}>{o.hint}</p>}
        </button>
      ))}
    </div>
  );
}

const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label className="flex items-center gap-3">
    <input type="checkbox" className="h-5 w-5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);

export default function AgentPage() {
  const [data, setData] = useState<Data | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agent-settings").then(async (r) => (r.ok ? setData(await r.json()) : setAuthError((await r.json()).error)));
  }, []);

  async function save() {
    if (!data) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/agent-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data.role === "seller" ? { settings: data.settings, profile: data.profile } : { settings: data.settings }),
    });
    setSaving(false);
    if (!res.ok) return setError((await res.json()).error ?? "Couldn't save");
    setSaved(true);
  }

  if (authError)
    return (
      <main className="p-8">
        {authError}.{" "}
        <Link href="/login?next=/agent" className="underline">
          Log in
        </Link>
      </main>
    );
  if (!data) return <main className="p-8 text-neutral-500">Loading…</main>;

  const input = "w-full rounded-lg border border-neutral-300 px-3 py-2";
  const setSeller = (patch: Partial<SellerSettings>) =>
    setData((d) => (d && d.role === "seller" ? { ...d, settings: { ...d.settings, ...patch } } : d));
  const setProfile = (patch: Partial<SellerProfile>) =>
    setData((d) => (d && d.role === "seller" ? { ...d, profile: { ...d.profile, ...patch } } : d));
  const setBuyer = (patch: Partial<BuyerSettings>) =>
    setData((d) => (d && d.role === "buyer" ? { ...d, settings: { ...d.settings, ...patch } } : d));

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <header>
        <p className="text-sm uppercase tracking-wide text-neutral-500">My agent</p>
        <h1 className="text-3xl font-semibold">
          {data.role === "seller" ? `${data.name}'s sales agent` : `${data.name}'s shopping agent`}
        </h1>
        <p className="mt-1 text-neutral-600">
          Your agent negotiates for you with these settings. Whatever you choose, your{" "}
          {data.role === "seller" ? "floor" : "budget"} is enforced in code and never shown to the other side.
        </p>
      </header>

      {data.role === "seller" ? (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">How firmly it holds your price</h2>
            <Choice options={SELLER_STYLES} value={data.settings.agentStyle} onChange={(v) => setSeller({ agentStyle: v })} />
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">What it may offer</h2>
            <Toggle checked={data.settings.offerGiftWrap} onChange={(v) => setSeller({ offerGiftWrap: v })} label="Gift wrapping instead of a bigger discount" />
            <Toggle checked={data.settings.offerBundles} onChange={(v) => setSeller({ offerBundles: v })} label="A second item as a bundle after a sale" />
            {data.settings.offerBundles && (
              <label className="block max-w-xs text-sm text-neutral-600">
                Max bundle discount: {data.settings.maxBundleDiscountPct}%
                <input
                  type="range"
                  min={0}
                  max={30}
                  value={data.settings.maxBundleDiscountPct}
                  onChange={(e) => setSeller({ maxBundleDiscountPct: Number(e.target.value) })}
                  className="block w-full"
                />
              </label>
            )}
            <label className="block text-sm text-neutral-600">
              Your instructions for your agent (optional)
              <textarea
                className={input}
                rows={2}
                maxLength={300}
                placeholder="e.g. Mention that the zari is real gold thread. Never offer free shipping."
                value={data.settings.agentNote ?? ""}
                onChange={(e) => setSeller({ agentNote: e.target.value })}
              />
            </label>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">What it knows about you</h2>
            <label className="block text-sm text-neutral-600">
              Your story (what your agent tells buyers)
              <textarea className={input} rows={3} value={data.profile.story} onChange={(e) => setProfile({ story: e.target.value })} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2 text-sm text-neutral-600">
              <label>
                Language for your notifications
                <select className={input} value={data.profile.language} onChange={(e) => setProfile({ language: e.target.value as "en" | "hi" })}>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label>
                Agent may refund on its own up to (£)
                <input className={input} type="number" min={0} value={data.profile.refundCap} onChange={(e) => setProfile({ refundCap: Number(e.target.value) })} />
              </label>
              <label>
                You ship within (days, max 3)
                <input className={input} type="number" min={1} max={3} value={data.profile.shipByDays} onChange={(e) => setProfile({ shipByDays: Number(e.target.value) })} />
              </label>
              <label>
                Delivery takes (days)
                <input className={input} type="number" min={1} max={30} value={data.profile.transitDays} onChange={(e) => setProfile({ transitDays: Number(e.target.value) })} />
              </label>
            </div>
            <p className="text-xs text-neutral-500">Floors and per-item refund caps are set on each listing at Sell.</p>
          </section>
        </>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">How hard it haggles</h2>
            <Choice options={BUYER_STYLES} value={data.settings.agentStyle} onChange={(v) => setBuyer({ agentStyle: v })} />
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">What matters most when it recommends a deal</h2>
            <Choice options={PRIORITIES} value={data.settings.priority} onChange={(v) => setBuyer({ priority: v })} />
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Scope</h2>
            <label className="block max-w-xs text-sm text-neutral-600">
              Negotiate with up to {data.settings.maxSellers} seller{data.settings.maxSellers === 1 ? "" : "s"} at once
              <input type="range" min={1} max={3} value={data.settings.maxSellers} onChange={(e) => setBuyer({ maxSellers: Number(e.target.value) })} className="block w-full" />
            </label>
            <Toggle checked={data.settings.acceptBundles} onChange={(v) => setBuyer({ acceptBundles: v })} label="May accept a bundle if it fits my request and budget" />
            <p className="text-xs text-neutral-500">You always approve the final deal yourself, with one tap.</p>
          </section>
        </>
      )}

      <div className="flex items-center gap-4">
        <button onClick={save} disabled={saving} className="rounded-lg bg-neutral-900 px-5 py-3 text-white disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-green-700">Saved. Your agent uses this from its next negotiation.</span>}
        {error && <span className="text-red-700">{error}</span>}
      </div>
    </main>
  );
}
