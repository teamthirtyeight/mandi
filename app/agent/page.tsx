"use client";

// "My agent": how the signed-in seller's or buyer's agent behaves. Sellers set
// how firmly it holds the price, what it may offer, and the profile it argues
// from; buyers set how hard it haggles, how many sellers it talks to, and what
// matters most when it recommends a deal.
import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { LANGUAGE_INFO, SELLER_LANGUAGES, type SellerLanguage } from "@/lib/i18n/seller";

type SellerSettings = {
  agentStyle: "firm" | "balanced" | "flexible";
  offerGiftWrap: boolean;
  offerBundles: boolean;
  maxBundleDiscountPct: number;
  agentNote: string | null;
};
type SellerProfile = {
  story: string;
  language: SellerLanguage;
  shipByDays: number;
  transitDays: number;
  refundCap: number;
  whatsappNumber: string;
  paypalEmail: string;
  whatsappOptIn: boolean;
};
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
  { v: "firm", label: "Firm", hint: "Small concessions. Adds value, like gift wrapping, before cutting the price." },
  { v: "balanced", label: "Balanced", hint: "Comes down in shrinking steps." },
  { v: "flexible", label: "Flexible", hint: "Moves quickly to close the sale." },
] as const;
const BUYER_STYLES = [
  { v: "patient", label: "Patient", hint: "Small steps. Uses every round to get the best price." },
  { v: "balanced", label: "Balanced", hint: "Comes up slowly." },
  { v: "quick", label: "Quick", hint: "Agrees on a fair price early." },
] as const;
const PRIORITIES = [
  { v: "price", label: "Lowest price", hint: "Cheapest deal that arrives in time." },
  { v: "balanced", label: "Balanced", hint: "Weighs price, delivery and the seller's offer." },
  { v: "delivery", label: "Fastest delivery", hint: "Earliest arrival within your budget." },
] as const;

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { v: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button
            type="button"
            role="radio"
            aria-checked={on}
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`rounded-xl border px-4 py-3 text-left ${on ? "border-indigo bg-indigo-soft ring-1 ring-indigo" : "border-line-strong bg-raised hover:border-ink-3"}`}
          >
            <span className={`flex items-center gap-2 font-semibold ${on ? "text-indigo" : ""}`}>
              <span
                aria-hidden="true"
                className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${on ? "border-indigo" : "border-line-strong"}`}
              >
                {on && <span className="h-1.5 w-1.5 rounded-full bg-indigo" />}
              </span>
              {o.label}
            </span>
            {o.hint && <span className="mt-1 block text-sm text-ink-2">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p id={`${id}-l`} className="font-semibold">
          {label}
        </p>
        {hint && (
          <p id={`${id}-h`} className="hint mt-0.5">
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={hint ? `${id}-h` : undefined}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-indigo" : "bg-line-strong"}`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-1 h-5 w-5 rounded-full bg-paper shadow transition-[left] ${checked ? "left-6" : "left-1"}`}
        />
      </button>
    </div>
  );
}

function Section({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <section className="panel p-6">
      <h2 className="title text-xl">{title}</h2>
      <p className="mt-1 text-ink-2">{body}</p>
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

interface WaMessage {
  id: string;
  to: string;
  body: string;
  status: "sent" | "logged" | "failed" | "received";
  error: string | null;
  createdAt: string;
}

// Test button and the last few messages, so a seller (or a judge) can see
// exactly what their agent sent.
/** The buyer's MCP key and how to plug it into an assistant. */
function McpPanel() {
  const [state, setState] = useState<{ key: string | null; url: string | null; endpoint: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/me/api-key").then(async (r) => r.ok && setState(await r.json()));
  }, []);
  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };
  async function create() {
    if (state?.key && !confirm("Make a new key? Assistants using the old one will stop working.")) return;
    setBusy(true);
    const res = await fetch("/api/me/api-key", { method: "POST" });
    if (res.ok) setState(await res.json());
    setBusy(false);
  }
  const claudeCode = state?.key ? `claude mcp add --transport http mandi ${state.endpoint} --header "Authorization: Bearer ${state.key}"` : "";
  return (
    <div className="space-y-4">
      {state?.url ? (
        <>
          <div>
            <p className="label">Connector URL (Claude, ChatGPT and other apps)</p>
            <div className="flex gap-2">
              <input className="field money text-sm" readOnly value={state.url} onFocus={(e) => e.currentTarget.select()} aria-label="Connector URL" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy("url", state.url!)}>
                {copied === "url" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="hint mt-1">Add it as a custom connector. Treat it like a password: anyone with it can shop as you (but never pay).</p>
          </div>
          <div>
            <p className="label">Claude Code</p>
            <div className="flex gap-2">
              <input className="field money text-sm" readOnly value={claudeCode} onFocus={(e) => e.currentTarget.select()} aria-label="Claude Code command" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy("cc", claudeCode)}>
                {copied === "cc" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <p className="well p-4 text-sm text-ink-2">
            Then ask it: &ldquo;Find me a handwoven silk scarf on Mandi for my mum, under £90, by 20 December.&rdquo; It sends your agent, follows the bargaining,
            and hands you the link to approve the deal in PayPal.
          </p>
        </>
      ) : (
        <p className="text-ink-2">No assistant connected yet.</p>
      )}
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={create}>
        {state?.key ? "Make a new key" : "Create a connection key"}
      </button>
    </div>
  );
}

function WhatsAppPanel({ unsaved }: { unsaved: boolean }) {
  const [state, setState] = useState<{ live: boolean; messages: WaMessage[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/whatsapp/test", { cache: "no-store" });
    if (res.ok) setState(await res.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const STATUS: Record<WaMessage["status"], { label: string; cls: string }> = {
    sent: { label: "Sent", cls: "chip-safe" },
    logged: { label: "Recorded, not sent", cls: "" },
    received: { label: "You wrote", cls: "chip-progress" },
    failed: { label: "Failed", cls: "chip-bad" },
  };

  return (
    <div className="well space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          {state?.live
            ? "Messages are sent through Twilio's WhatsApp service."
            : "WhatsApp isn't connected on this server yet, so messages are recorded here instead of sent."}
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || unsaved}
          title={unsaved ? "Save your changes first" : undefined}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await fetch("/api/whatsapp/test", { method: "POST" });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) setError(body.error ?? body.message?.error ?? "Couldn't send the test message");
            setBusy(false);
            load();
          }}
        >
          {busy ? "Sending…" : "Send a test message"}
        </button>
      </div>
      {unsaved && <p className="hint">Save your changes before sending a test message.</p>}
      {error && (
        <p role="alert" className="notice notice-bad text-sm">
          {error}
        </p>
      )}
      {state && state.messages.length > 0 && (
        <ul className="space-y-2" aria-label="Recent WhatsApp messages">
          {state.messages.map((m) => (
            <li key={m.id} className="rounded-xl bg-raised p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="money text-ink-3">{m.to}</span>
                <span className="flex items-center gap-2">
                  <span className={`chip ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span>
                  <time className="text-ink-3" dateTime={m.createdAt}>
                    {new Date(m.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </time>
                </span>
              </div>
              <p className="mt-2 whitespace-pre-line text-ink">{m.body.replace(/\*/g, "")}</p>
              {m.error && <p className="mt-1 text-madder">{m.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AgentPage() {
  const [data, setData] = useState<Data | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
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
    setDirty(false);
  }

  if (authError)
    return (
      <main className="page-narrow">
        <div className="panel p-6">
          <p className="title text-xl">{authError}</p>
          <p className="mt-1 text-ink-2">Log in to change how your agent negotiates.</p>
          <Link href="/login?next=/agent" className="btn btn-primary mt-5">
            Log in
          </Link>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="page-narrow" aria-busy="true">
        <div className="h-10 w-64 animate-pulse rounded-lg bg-surface" />
        <div className="mt-8 h-48 animate-pulse rounded-[1.25rem] bg-surface" />
      </main>
    );

  const touched = () => {
    setSaved(false);
    setDirty(true);
  };
  const setSeller = (patch: Partial<SellerSettings>) => {
    touched();
    setData((d) => (d && d.role === "seller" ? { ...d, settings: { ...d.settings, ...patch } } : d));
  };
  const setProfile = (patch: Partial<SellerProfile>) => {
    touched();
    setData((d) => (d && d.role === "seller" ? { ...d, profile: { ...d.profile, ...patch } } : d));
  };
  const setBuyer = (patch: Partial<BuyerSettings>) => {
    touched();
    setData((d) => (d && d.role === "buyer" ? { ...d, settings: { ...d.settings, ...patch } } : d));
  };

  return (
    <main className="page-narrow pb-32">
      <header>
        <h1 className="display text-4xl">My agent</h1>
        <p className="mt-3 text-lg text-ink-2">
          {data.role === "seller" ? `${data.name}'s sales agent` : `${data.name}'s shopping agent`} negotiates with these
          settings. Whatever you choose, your {data.role === "seller" ? "floor price" : "budget"} is enforced by Mandi&apos;s
          rules engine and is never shown to the other side.
        </p>
      </header>

      <div className="mt-8 space-y-6">
        {data.role === "seller" ? (
          <>
            <Section title="How firmly it holds your price" body="How quickly your agent comes down from the list price towards your floor.">
              <Choice label="Negotiating style" options={SELLER_STYLES} value={data.settings.agentStyle} onChange={(v) => setSeller({ agentStyle: v })} />
            </Section>

            <Section title="What it may offer" body="Extras your agent can use to close a sale without cutting the price further.">
              <Toggle
                checked={data.settings.offerGiftWrap}
                onChange={(v) => setSeller({ offerGiftWrap: v })}
                label="Gift wrapping"
                hint="Offered instead of a bigger discount."
              />
              <Toggle
                checked={data.settings.offerBundles}
                onChange={(v) => setSeller({ offerBundles: v })}
                label="Bundles"
                hint="After a deal is agreed, your agent may offer a second item of yours at a discount."
              />
              {data.settings.offerBundles && (
                <div className="well p-4">
                  <label htmlFor="bundle-discount" className="label flex justify-between">
                    <span>Largest bundle discount</span>
                    <span className="money text-indigo">{data.settings.maxBundleDiscountPct}%</span>
                  </label>
                  <input
                    id="bundle-discount"
                    type="range"
                    min={0}
                    max={30}
                    value={data.settings.maxBundleDiscountPct}
                    onChange={(e) => setSeller({ maxBundleDiscountPct: Number(e.target.value) })}
                    aria-valuetext={`${data.settings.maxBundleDiscountPct}%`}
                    className="block w-full accent-[var(--indigo)]"
                  />
                  <p className="hint mt-1">The bundle price never goes below the second item&apos;s floor.</p>
                </div>
              )}
              <div>
                <label htmlFor="agent-note" className="label">
                  Instructions for your agent <span className="font-normal text-ink-3">(optional)</span>
                </label>
                <textarea
                  id="agent-note"
                  className="field"
                  rows={3}
                  maxLength={300}
                  placeholder="e.g. Mention that the zari is real gold thread. Never offer free shipping."
                  value={data.settings.agentNote ?? ""}
                  onChange={(e) => setSeller({ agentNote: e.target.value })}
                  aria-describedby="agent-note-hint"
                />
                <p id="agent-note-hint" className="hint mt-1">
                  {(data.settings.agentNote ?? "").length}/300. Your agent follows these but can never break your floor.
                </p>
              </div>
            </Section>

            <Section title="What it knows about you" body="Your agent tells buyers your story and promises delivery based on these.">
              <div>
                <label htmlFor="story" className="label">
                  Your story
                </label>
                <textarea id="story" className="field" rows={4} value={data.profile.story} onChange={(e) => setProfile({ story: e.target.value })} />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="language" className="label">
                    Language for your alerts
                  </label>
                  <select id="language" className="field" value={data.profile.language} onChange={(e) => setProfile({ language: e.target.value as SellerLanguage })}>
                    {SELLER_LANGUAGES.map((code) => (
                      <option key={code} value={code}>
                        {code === "en" ? "English" : `${LANGUAGE_INFO[code].native} (${LANGUAGE_INFO[code].name})`}
                      </option>
                    ))}
                  </select>
                  <p className="hint mt-1">Your phone view, alerts and WhatsApp messages use this language.</p>
                </div>
                <div>
                  <label htmlFor="refund-cap" className="label">
                    Agent may refund on its own up to
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-ink-2">£</span>
                    <input id="refund-cap" className="field money" type="number" min={0} value={data.profile.refundCap} onChange={(e) => setProfile({ refundCap: Number(e.target.value) })} />
                  </div>
                </div>
                <div>
                  <label htmlFor="ship-by" className="label">
                    You ship within
                  </label>
                  <div className="flex items-center gap-2">
                    <input id="ship-by" className="field money" type="number" min={1} max={3} value={data.profile.shipByDays} onChange={(e) => setProfile({ shipByDays: Number(e.target.value) })} />
                    <span className="text-ink-2">days</span>
                  </div>
                  <p className="hint mt-1">Up to 3, while PayPal holds the money.</p>
                </div>
                <div>
                  <label htmlFor="transit" className="label">
                    Delivery takes
                  </label>
                  <div className="flex items-center gap-2">
                    <input id="transit" className="field money" type="number" min={1} max={30} value={data.profile.transitDays} onChange={(e) => setProfile({ transitDays: Number(e.target.value) })} />
                    <span className="text-ink-2">days</span>
                  </div>
                </div>
              </div>
              <p className="hint">
                Floor prices and per-item refund limits are set on each listing in{" "}
                <Link href="/dashboard" className="link">
                  your dashboard
                </Link>
                .
              </p>
            </Section>

            <Section title="Getting paid" body="When a buyer's money is released, Mandi sends your share, minus a 5% fee, to this PayPal account.">
              <div>
                <label htmlFor="paypal-email" className="label">
                  PayPal email for payouts
                </label>
                <input
                  id="paypal-email"
                  className="field"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={data.profile.paypalEmail}
                  onChange={(e) => setProfile({ paypalEmail: e.target.value })}
                  aria-describedby="paypal-email-hint"
                />
                <p id="paypal-email-hint" className="hint mt-1">
                  The email you log in to PayPal with. Payouts that failed earlier are sent again when you save.
                </p>
              </div>
            </Section>

            <Section
              title="Alerts on WhatsApp"
              body="Your agent messages you on WhatsApp when something sells, when money arrives, and when a buyer needs a refund approved. In your language, with amounts in rupees. Reply to run your shop: send a photo of the shipping receipt to ship, answer yes or no, or write “status”."
            >
              <div>
                <label htmlFor="whatsapp" className="label">
                  WhatsApp number
                </label>
                <input
                  id="whatsapp"
                  className="field money"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  value={data.profile.whatsappNumber}
                  onChange={(e) => setProfile({ whatsappNumber: e.target.value })}
                  aria-describedby="whatsapp-hint"
                />
                <p id="whatsapp-hint" className="hint mt-1">
                  With the country code. A 10-digit Indian mobile number works too.
                </p>
              </div>
              <Toggle
                checked={data.profile.whatsappOptIn}
                onChange={(v) => setProfile({ whatsappOptIn: v })}
                label="Send my alerts on WhatsApp"
                hint="You can turn this off at any time. Alerts still appear in Mandi."
              />
              <WhatsAppPanel unsaved={dirty} />
            </Section>
          </>
        ) : (
          <>
            <Section title="How hard it haggles" body="How quickly your agent comes up from its first offer. It never goes over your budget.">
              <Choice label="Negotiating style" options={BUYER_STYLES} value={data.settings.agentStyle} onChange={(v) => setBuyer({ agentStyle: v })} />
            </Section>
            <Section title="What matters most" body="How your agent ranks the deals it gets, to pick the one it recommends.">
              <Choice label="Priority" options={PRIORITIES} value={data.settings.priority} onChange={(v) => setBuyer({ priority: v })} />
            </Section>
            <Section title="Scope" body="How widely your agent shops for each request.">
              <div>
                <label htmlFor="max-sellers" className="label flex justify-between">
                  <span>Sellers to negotiate with at once</span>
                  <span className="money text-indigo">{data.settings.maxSellers}</span>
                </label>
                <input
                  id="max-sellers"
                  type="range"
                  min={1}
                  max={3}
                  value={data.settings.maxSellers}
                  onChange={(e) => setBuyer({ maxSellers: Number(e.target.value) })}
                  aria-valuetext={`${data.settings.maxSellers} seller${data.settings.maxSellers === 1 ? "" : "s"}`}
                  className="block w-full accent-[var(--indigo)]"
                />
                <p className="hint mt-1">More sellers means more choice; each one is a separate negotiation.</p>
              </div>
              <Toggle
                checked={data.settings.acceptBundles}
                onChange={(v) => setBuyer({ acceptBundles: v })}
                label="Accept bundles"
                hint="Your agent may add a second item from the same seller if it fits your request and budget."
              />
              <p className="notice text-sm">You always approve the final deal yourself, in PayPal.</p>
            </Section>
            <Section
              title="Connect your own AI assistant"
              body="Let Claude, ChatGPT or any assistant that supports MCP shop at Mandi for you: search, send your agent to bargain, and follow the deal. It can't pay. Every deal comes back to you to approve in PayPal."
            >
              <McpPanel />
            </Section>
          </>
        )}
      </div>

      <div className="sticky bottom-4 z-30 mt-8">
        <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-3 pl-5 shadow-[0_12px_40px_-12px_rgb(21_25_53/0.35)]">
          <p className="flex-1 text-sm" role="status" aria-live="polite">
            {error ? (
              <span className="text-madder">{error}</span>
            ) : saved ? (
              <span className="font-semibold text-leaf">Saved. Your agent uses this from its next negotiation.</span>
            ) : dirty ? (
              <span className="text-ink-2">You have unsaved changes.</span>
            ) : (
              <span className="text-ink-3">Changes apply to new negotiations.</span>
            )}
          </p>
          <button onClick={save} disabled={saving || (!dirty && !error)} className="btn btn-primary">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </main>
  );
}
