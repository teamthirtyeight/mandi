"use client";

// Negotiation room: one live thread per seller, every turn shown with the
// price the agent proposed and the price the engine allowed. When the buyer
// agent recommends a deal, one tap opens PayPal (authorize, money held).
import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { DemoLogin } from "@/components/DemoLogin";
import { OffersChart } from "@/components/OffersChart";
import { ListingImage } from "@/components/ListingImage";
import { NegotiationChat, type ChatLine } from "@/components/NegotiationChat";
import type { MandateSnapshot } from "@/lib/negotiation/snapshot";
import { CheckIcon, LockIcon } from "@/components/Icons";

type Turn = MandateSnapshot["turns"][number];
type Neg = MandateSnapshot["negotiations"][number];
interface ScoredDeal {
  negotiationId: string;
  sellerName: string;
  title: string;
  agreedMinor: number;
  currency: string;
  reasons: string[];
  addon?: { title: string; priceMinor: number } | null;
}
interface Recommendation {
  best: ScoredDeal | null;
  ranked: ScoredDeal[];
}

const FINAL = new Set(["recommended", "no_deal", "no_match", "failed", "interrupted", "cancelled"]);
const money = (n: number | null, c = "GBP") =>
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: c }).format(n);

const STATE_LABEL: Record<string, string> = {
  OPEN: "Waiting",
  OFFERED: "Negotiating",
  COUNTERED: "Negotiating",
  AGREED: "Agreed",
  AWAITING_BUYER_APPROVAL: "Awaiting approval",
  ORDERED: "Ordered",
  WALKED_AWAY: "Walked away",
  EXPIRED: "Closed",
  BLOCKED_BY_GUARDRAIL: "Blocked",
  CANCELLED: "Cancelled",
};

// Chip colour per negotiation state: indigo while talking, haldi once agreed,
// leaf once paid, madder when the engine stopped it, plain when closed.
const STATE_CHIP: Record<string, string> = {
  OPEN: "chip-progress",
  OFFERED: "chip-progress",
  COUNTERED: "chip-progress",
  AGREED: "chip-agreed",
  AWAITING_BUYER_APPROVAL: "chip-agreed",
  ORDERED: "chip-safe",
  BLOCKED_BY_GUARDRAIL: "chip-bad",
};

// One stored turn as a chat line (components/NegotiationChat).
function toLine(t: Turn): ChatLine {
  if (t.from === "engine") return { id: t.id, from: "engine", text: t.message, price: null, blocked: t.guardrail_result.startsWith("REJECTED") };
  const notes: string[] = [];
  if (t.injection) notes.push("Injection attempt ignored");
  if (t.limit_redacted) notes.push("Engine withheld a private limit");
  // Rule-based replies are counted once in the column header, not on every bubble.
  if (t.source === "script") notes.push(t.from === "buyer" ? "Scripted attack" : "Simulated compromised agent");
  if (t.guardrail_result === "ADDON_OFFERED") notes.push("Bundle offer, after the deal");
  // A declined bundle has no price of its own to show.
  const price = t.guardrail_result === "ADDON_DECLINED" ? null : t.final_price;
  return { id: t.id, from: t.from as "seller" | "buyer", text: t.message, price, notes };
}

export default function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [snap, setSnap] = useState<MandateSnapshot | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [states, setStates] = useState<Record<string, { state: string; agreed: number | null }>>({});
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [status, setStatus] = useState<string>("negotiating");
  const [held, setHeld] = useState<{ orderId: string; amount: number; status?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  // Replay re-streams the stored turns at reading speed (for recording takes).
  const [replay, setReplay] = useState<{ index: number; speed: number } | null>(null);

  const [denied, setDenied] = useState<string | null>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/mandates/${id}`, { cache: "no-store" });
      if (cancelled) return;
      if (res.status === 401 || res.status === 403) return setDenied((await res.json()).error);
      es = new EventSource(`/api/mandates/${id}/stream`);
      listen(es);
    })();
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [id]);

  function listen(es: EventSource) {
    const addTurn = (t: Turn) => {
      if (seen.current.has(t.id)) return;
      seen.current.add(t.id);
      setTurns((prev) => [...prev, t]);
      setStates((prev) => ({ ...prev, [t.negotiation_id]: { state: t.state, agreed: prev[t.negotiation_id]?.agreed ?? null } }));
    };
    es.addEventListener("snapshot", (e) => {
      const s: MandateSnapshot = JSON.parse((e as MessageEvent).data);
      setSnap(s);
      setStatus(s.mandate.status);
      setStates(Object.fromEntries(s.negotiations.map((n) => [n.id, { state: n.state, agreed: n.agreedPrice }])));
      s.turns.forEach(addTurn);
      if (s.mandate.recommendation) setRec(s.mandate.recommendation as Recommendation);
      if (s.order) {
        setChosenId(s.order.negotiationId);
        setHeld({ orderId: s.order.id, amount: s.order.amount, status: s.order.status });
      }
      if (FINAL.has(s.mandate.status)) es.close();
    });
    es.addEventListener("turn", (e) => addTurn(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("state", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setStates((prev) => ({ ...prev, [d.negotiation_id]: { state: d.state, agreed: d.agreed_price } }));
    });
    es.addEventListener("recommendation", (e) => setRec(JSON.parse((e as MessageEvent).data).recommendation));
    es.addEventListener("done", (e) => {
      setStatus(JSON.parse((e as MessageEvent).data).status);
      es.close();
    });
  }

  useEffect(() => {
    if (!replay) return;
    if (replay.index >= turns.length) {
      setReplay(null);
      return;
    }
    const t = setTimeout(() => setReplay((r) => (r ? { ...r, index: r.index + 1 } : r)), 900 / replay.speed);
    return () => clearTimeout(t);
  }, [replay, turns.length]);

  const shown = replay ? turns.slice(0, replay.index) : turns;

  const bySeller = useMemo(() => {
    const m = new Map<string, Turn[]>();
    for (const t of shown) m.set(t.negotiation_id, [...(m.get(t.negotiation_id) ?? []), t]);
    return m;
  }, [shown]);

  if (denied)
    return (
      <main className="page-narrow">
        <div className="panel p-8">
          <h1 className="title text-2xl">This negotiation room is private</h1>
          <p className="mt-2 text-ink-2">{denied}.</p>
          <Link href={`/login?next=/deal/${id}`} className="btn btn-primary mt-6">
            Log in as the buyer
          </Link>
        </div>
      </main>
    );
  if (!snap)
    return (
      <main className="mx-auto w-full max-w-[84rem] space-y-6 px-4 pb-24 pt-8 sm:px-6" aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-surface" />
        <div className="h-9 w-2/3 animate-pulse rounded-lg bg-surface" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[4.5rem] animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-96 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      </main>
    );
  const currency = snap.mandate.currency;
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  // The buyer can pick any agreed deal; the recommendation is the default.
  const best = (chosenId && rec?.ranked.find((d) => d.negotiationId === chosenId)) || rec?.best || null;
  const isRecommended = best != null && best.negotiationId === rec?.best?.negotiationId;
  const bestTotal = best ? best.agreedMinor + (best.addon?.priceMinor ?? 0) : 0;
  const deadline = new Date(snap.mandate.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  const live = !FINAL.has(status);

  const lastPrice = (ts: Turn[], who: "buyer" | "seller") =>
    [...ts].reverse().find((t) => t.from === who && t.final_price != null && !t.guardrail_result.startsWith("ADDON"))?.final_price ?? null;

  const agreedCount = snap.negotiations.filter((n) => {
    const s = states[n.id]?.state ?? n.state;
    return s === "AGREED" || s === "AWAITING_BUYER_APPROVAL" || s === "ORDERED";
  }).length;
  const summary = [
    { label: "Budget", value: money(snap.mandate.maxPrice, currency), mono: true },
    { label: "Arrive by", value: deadline, mono: false },
    { label: "Sellers contacted", value: String(snap.negotiations.length), mono: true },
    { label: "Deals agreed", value: live && agreedCount === 0 ? "—" : String(agreedCount), mono: true },
  ];

  return (
    <main className="mx-auto w-full max-w-[84rem] space-y-6 px-4 pb-24 pt-8 sm:px-6">
      <header className="space-y-5">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <Link href="/shop" className="hover:text-ink">
            Shop
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-ink-2">Negotiation room</span>
          {live ? (
            <span className="chip chip-progress ml-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo" aria-hidden="true" />
              Agents are negotiating
            </span>
          ) : status === "cancelled" ? (
            <span className="chip ml-1">Cancelled</span>
          ) : null}
          {snap.mandate.hostile && (
            <span className="chip chip-bad">
              {snap.mandate.compromised ? "Attack test: compromised seller agent" : "Hostile buyer test"}
            </span>
          )}
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="title max-w-4xl text-[clamp(1.5rem,2.6vw,2rem)]">&ldquo;{snap.mandate.requestText}&rdquo;</h1>
          <div className="flex flex-wrap items-center gap-2">
            {FINAL.has(status) && turns.length > 0 &&
              (replay ? (
                <>
                  <button onClick={() => setReplay(null)} className="btn btn-secondary btn-sm">
                    Stop replay
                  </button>
                  <button
                    onClick={() => setReplay((r) => (r ? { ...r, speed: r.speed === 1 ? 2 : 1 } : r))}
                    className="btn btn-secondary btn-sm"
                    aria-label="Change replay speed"
                  >
                    {replay.speed}× speed
                  </button>
                </>
              ) : (
                <button onClick={() => setReplay({ index: 0, speed: 1 })} className="btn btn-secondary btn-sm">
                  Replay negotiation
                </button>
              ))}
            {!held &&
              ["negotiating", "recommended", "no_deal"].includes(status) &&
              (confirmCancel ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-madder-soft px-3 py-1.5 text-sm" role="group" aria-label="Confirm cancel">
                  <span className="text-madder">Stop your agent? Nothing is charged.</span>
                  <button
                    onClick={async () => {
                      const res = await fetch(`/api/mandates/${id}/cancel`, { method: "POST" });
                      setConfirmCancel(false);
                      if (res.ok) setStatus("cancelled");
                      else setError((await res.json()).error);
                    }}
                    className="btn btn-danger btn-sm"
                  >
                    Yes, cancel
                  </button>
                  <button onClick={() => setConfirmCancel(false)} className="btn btn-secondary btn-sm">
                    Keep going
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmCancel(true)} className="btn btn-secondary btn-sm">
                  Cancel request
                </button>
              ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-raised shadow-[var(--shadow-xs)] md:grid-cols-4">
          {summary.map((s, i) => (
            <div
              key={s.label}
              className={`px-5 py-3.5 ${i > 0 ? "border-line md:border-l" : ""} ${i % 2 === 1 ? "border-l" : ""} ${i > 1 ? "border-t md:border-t-0" : ""}`}
            >
              <dt className="stat-label">{s.label}</dt>
              <dd className={`mt-1 text-lg ${s.mono ? "stat-value" : "font-semibold tracking-[-0.015em]"}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {best && !replay && status !== "cancelled" && (
        <section
          aria-labelledby="deal-title"
          className="panel panel-raised relative grid overflow-hidden md:grid-cols-[1fr_minmax(17rem,24rem)]"
        >
          <span className={`absolute inset-x-0 top-0 h-1 ${held ? "bg-leaf" : "bg-haldi"}`} aria-hidden="true" />
          <div className="p-6 sm:p-7">
            <span className={`chip ${held ? "chip-safe" : "chip-agreed"}`}>{isRecommended ? "Recommended deal" : "Your choice"}</span>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 id="deal-title" className="title text-2xl">
                {best.sellerName}
              </h2>
              <span className="money text-[2rem] leading-none tracking-[-0.03em]">{money(bestTotal / 100, best.currency)}</span>
            </div>
            <p className="mt-2 text-ink-2">{best.title}</p>
            {best.addon && (
              <p className="mt-1 text-sm text-ink-2">
                Plus {best.addon.title}, bundled for <span className="money">{money(best.addon.priceMinor / 100, best.currency)}</span>
              </p>
            )}
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {best.reasons.map((r) => (
                <li key={r} className="flex items-start gap-2 text-sm text-ink-2">
                  <CheckIcon size={16} className="mt-0.5 shrink-0 text-leaf" />
                  {r}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col justify-center border-t border-line bg-surface p-6 md:border-l md:border-t-0">
            {held && (
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-leaf">
                  <LockIcon size={16} />
                  Payment secured
                </p>
                <p className="mt-2 font-semibold tracking-[-0.015em]">
                  {held.status === "CAPTURED"
                    ? `${money(held.amount, best.currency)} paid. ${best.sellerName} has shipped.`
                    : held.status === "SHIPPED"
                      ? `${money(held.amount, best.currency)} held. ${best.sellerName} has shipped.`
                      : held.status === "REFUNDED"
                        ? `Ordered for ${money(held.amount, best.currency)}, then refunded.`
                        : `${money(held.amount, best.currency)} held. Nothing is paid until ${best.sellerName} ships.`}
                </p>
                <Link href={`/order/${held.orderId}`} className="btn btn-primary mt-4 w-full">
                  Track the order
                </Link>
              </div>
            )}
            {!held && (
              <div className="mb-4">
                <p className="flex items-center gap-2 font-semibold">
                  <LockIcon size={16} className="text-indigo" />
                  Approve in PayPal
                </p>
                <p className="mt-1 text-sm text-ink-2">
                  PayPal holds <span className="money">{money(bestTotal / 100, best.currency)}</span>. {best.sellerName} is paid only
                  after shipping.
                </p>
              </div>
            )}
            {/* The PayPal buttons stay mounted (just hidden) after approval: removing
                them while the SDK is still closing its popup throws
                paypal_js_sdk_v5_unhandled_exception. */}
            {clientId ? (
              // "isolate" keeps PayPal's button frame (z-index 100) in its own layer,
              // so menus like the notifications panel open over it, not under it.
              <div hidden={Boolean(held)} className="relative isolate">
                <PayPalScriptProvider options={{ clientId, intent: "authorize", currency: best.currency }}>
                  <PayPalButtons
                    key={best.negotiationId}
                    style={{ layout: "horizontal", label: "pay", tagline: false }}
                    createOrder={async () => {
                      setError(null);
                      const res = await fetch(`/api/deals/${best.negotiationId}/approve`, { method: "POST" });
                      const body = await res.json();
                      if (!res.ok) throw new Error(body.error ?? "Could not create the order");
                      return body.id;
                    }}
                    onApprove={async (data) => {
                      const res = await fetch(`/api/paypal/orders/${data.orderID}/authorize`, { method: "POST" });
                      const body = await res.json();
                      if (!res.ok) return setError(body.error ?? "Authorize failed");
                      setHeld({ orderId: body.orderId, amount: bestTotal / 100 });
                    }}
                    onError={(err) => setError(String(err))}
                  />
                </PayPalScriptProvider>
              </div>
            ) : (
              <p className="notice text-sm">Set NEXT_PUBLIC_PAYPAL_CLIENT_ID to approve with PayPal.</p>
            )}
            {!held && clientId && (
              <div className="mt-2">
                <DemoLogin />
              </div>
            )}
            {error && (
              <p role="alert" className="notice notice-bad mt-3 text-sm">
                {error}
              </p>
            )}
          </div>
        </section>
      )}
      {FINAL.has(status) && !best && (
        <div className={`notice ${status === "failed" || status === "interrupted" ? "notice-bad" : ""} flex flex-wrap items-center justify-between gap-3`}>
          <p>
            {status === "failed"
              ? "Something went wrong running the agents. Nothing was charged."
              : status === "interrupted"
                ? "This negotiation was interrupted by a server restart. Nothing was charged. Please send your agent again from Shop."
                : status === "cancelled"
                  ? "You cancelled this request. Nothing was charged."
                  : "No seller agreed within your budget. Nothing was charged."}
          </p>
          <Link href="/shop" className="btn btn-secondary btn-sm">
            Send your agent again
          </Link>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        {snap.negotiations.map((n: Neg) => {
          const ts = bySeller.get(n.id) ?? [];
          const finalState = states[n.id]?.state ?? n.state;
          // During replay, show the final state only once that thread's last turn is back on screen.
          const total = turns.filter((t) => t.negotiation_id === n.id).length;
          const st =
            status === "cancelled" && finalState !== "ORDERED"
              ? "CANCELLED"
              : replay && ts.length < total
                ? ts.length
                  ? "COUNTERED"
                  : "OPEN"
                : finalState;
          const isBest = best?.negotiationId === n.id && status !== "cancelled";
          const backupReplies = ts.filter((t) => t.source === "fallback").length;
          return (
            <section
              key={n.id}
              className={`panel flex flex-col overflow-hidden ${isBest ? "border-haldi shadow-[0_0_0_1px_var(--haldi),var(--shadow-md)]" : ""}`}
              aria-label={`Negotiation with ${n.seller.name}`}
            >
              <header className="space-y-4 border-b border-line p-4">
                <div className="flex items-start gap-3">
                  <ListingImage src={n.listing.image} title={n.listing.title} className="h-12 w-12 shrink-0 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-[0.9375rem] font-semibold leading-tight tracking-[-0.015em]">
                        {n.seller.name}
                        <span className="ml-1.5 text-sm font-normal text-ink-3">{n.seller.city}</span>
                      </h2>
                      <span className={`chip ${STATE_CHIP[st] ?? ""}`}>{STATE_LABEL[st] ?? st}</span>
                    </div>
                    <Link href={`/listing/${n.listing.id}`} className="mt-0.5 block truncate text-sm text-ink-2 hover:text-ink hover:underline">
                      {n.listing.title}
                    </Link>
                  </div>
                </div>
                <dl className="grid grid-cols-3 divide-x divide-line rounded-lg border border-line">
                  <div className="px-3 py-2">
                    <dt className="stat-label">Seller asks</dt>
                    <dd className="stat-value mt-0.5">{money(lastPrice(ts, "seller"), currency)}</dd>
                  </div>
                  <div className="bg-indigo-soft/60 px-3 py-2">
                    <dt className="stat-label">You offer</dt>
                    <dd className="stat-value mt-0.5 text-indigo">{money(lastPrice(ts, "buyer"), currency)}</dd>
                  </div>
                  <div className="px-3 py-2">
                    <dt className="stat-label">List price</dt>
                    <dd className="stat-value mt-0.5 text-ink-2">{money(n.listing.listPrice, currency)}</dd>
                  </div>
                </dl>
                {backupReplies > 0 && (
                  <p className="hint" title="The AI didn't give a usable reply, so Mandi's rules engine replied instead.">
                    {backupReplies} {backupReplies === 1 ? "reply" : "replies"} from the rules engine
                  </p>
                )}
                {!held &&
                  status === "recommended" &&
                  st === "AGREED" &&
                  best?.negotiationId !== n.id &&
                  rec?.ranked.some((d) => d.negotiationId === n.id) && (
                    <button onClick={() => setChosenId(n.id)} className="btn btn-secondary btn-sm w-full">
                      Choose this deal instead
                    </button>
                  )}
                {n.addon && (
                  <p className="notice notice-safe text-sm">
                    Bundle accepted: {n.addon.title} for <span className="money">{money(n.addon.price, currency)}</span>
                  </p>
                )}
                <OffersChart turns={ts.filter((t) => !t.guardrail_result.startsWith("ADDON"))} budget={snap.mandate.maxPrice} />
              </header>
              <NegotiationChat
                scroll
                className="flex-1 p-4"
                lines={ts.map(toLine)}
                currency={currency}
                left={`${n.seller.name}'s agent`}
                right="Your agent"
                typing={!FINAL.has(status) && !["AGREED", "ORDERED", "WALKED_AWAY", "EXPIRED", "BLOCKED_BY_GUARDRAIL", "CANCELLED"].includes(st)}
                outcome={
                  st === "AGREED" || st === "ORDERED"
                    ? {
                        kind: "agreed",
                        price: states[n.id]?.agreed ?? n.agreedPrice ?? lastPrice(ts, "seller") ?? 0,
                        held: held && isBest ? `${money(held.amount, currency)} held by PayPal until it ships` : null,
                      }
                    : st === "WALKED_AWAY"
                      ? { kind: "walked", text: "No deal this time" }
                      : st === "BLOCKED_BY_GUARDRAIL"
                        ? { kind: "blocked", text: "Stopped by the rules engine" }
                        : st === "EXPIRED"
                          ? { kind: "walked", text: "Ran out of rounds without a deal" }
                          : st === "CANCELLED"
                            ? { kind: "walked", text: "You cancelled this request" }
                            : null
                }
              />
            </section>
          );
        })}
      </div>
    </main>
  );
}
