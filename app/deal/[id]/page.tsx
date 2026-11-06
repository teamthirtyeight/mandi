"use client";

// Negotiation room: one live thread per seller, every turn shown with the
// price the agent proposed and the price the engine allowed. When the buyer
// agent recommends a deal, one tap opens PayPal (authorize, money held).
import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { DemoLogin } from "@/components/DemoLogin";
import { OffersChart } from "@/components/OffersChart";
import type { MandateSnapshot } from "@/lib/negotiation/snapshot";

type Turn = MandateSnapshot["turns"][number];
type Neg = MandateSnapshot["negotiations"][number];
interface ScoredDeal {
  negotiationId: string;
  sellerName: string;
  title: string;
  agreedMinor: number;
  currency: string;
  reasons: string[];
}
interface Recommendation {
  best: ScoredDeal | null;
  ranked: ScoredDeal[];
}

const FINAL = new Set(["recommended", "no_deal", "no_match", "failed"]);
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
};

function GuardrailBadge({ t }: { t: Turn }) {
  const clamped = t.guardrail_result.startsWith("CLAMPED");
  const rejected = t.guardrail_result.startsWith("REJECTED");
  if (!clamped && !rejected && !t.injection) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1 text-xs">
      {t.injection && (
        <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">Injection attempt ignored</span>
      )}
      {clamped && (
        <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
          Engine: {money(t.proposed_price)} → {money(t.final_price)} ({t.guardrail_result.replaceAll("_", " ").toLowerCase()})
        </span>
      )}
      {rejected && <span className="rounded bg-red-100 px-2 py-0.5 text-red-900">Engine rejected the turn</span>}
    </div>
  );
}

export default function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [snap, setSnap] = useState<MandateSnapshot | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [states, setStates] = useState<Record<string, { state: string; agreed: number | null }>>({});
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [status, setStatus] = useState<string>("negotiating");
  const [held, setHeld] = useState<{ orderId: string; amount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  // Replay re-streams the stored turns at reading speed (for recording takes).
  const [replay, setReplay] = useState<{ index: number; speed: number } | null>(null);

  useEffect(() => {
    const es = new EventSource(`/api/mandates/${id}/stream`);
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
    return () => es.close();
  }, [id]);

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

  if (!snap)
    return (
      <main className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="h-16 w-2/3 animate-pulse rounded-xl bg-neutral-100" />
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-96 animate-pulse rounded-xl bg-neutral-100" />
          ))}
        </div>
      </main>
    );
  const currency = snap.mandate.currency;
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
  const best = rec?.best ?? null;

  const lastPrice = (ts: Turn[], who: "buyer" | "seller") =>
    [...ts].reverse().find((t) => t.from === who && t.final_price != null)?.final_price ?? null;

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-neutral-500">Negotiation room</p>
          <h1 className="text-2xl font-semibold">&ldquo;{snap.mandate.requestText}&rdquo;</h1>
        </div>
        <p className="text-lg">
          Budget <span className="font-semibold">{money(snap.mandate.maxPrice, currency)}</span> · by {snap.mandate.deadline}
          {snap.mandate.hostile && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-sm text-amber-900">Hostile buyer test</span>}
        </p>
        {FINAL.has(status) && turns.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            {replay ? (
              <>
                <button onClick={() => setReplay(null)} className="rounded-lg border border-neutral-300 px-3 py-1">
                  Stop replay
                </button>
                <button onClick={() => setReplay((r) => (r ? { ...r, speed: r.speed === 1 ? 2 : 1 } : r))} className="rounded-lg border border-neutral-300 px-3 py-1">
                  {replay.speed}×
                </button>
              </>
            ) : (
              <button onClick={() => setReplay({ index: 0, speed: 1 })} className="rounded-lg border border-neutral-300 px-3 py-1">
                Replay negotiation
              </button>
            )}
          </div>
        )}
      </header>

      {best && !replay && (
        <section className="rounded-xl border-2 border-green-300 bg-green-50 p-5">
          <p className="text-sm uppercase tracking-wide text-green-800">Recommended deal</p>
          <p className="text-[28px] font-semibold text-green-950">
            {best.sellerName} · {money(best.agreedMinor / 100, best.currency)}
          </p>
          <p className="text-green-900">{best.title}</p>
          <ul className="mt-2 list-disc pl-5 text-green-900">
            {best.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="mt-4 max-w-sm">
            {held ? (
              <div>
                <p className="text-xl font-semibold text-green-950">{money(held.amount, best.currency)} held — nothing is paid until {best.sellerName} ships</p>
                <Link href={`/order/${held.orderId}`} className="mt-2 inline-block font-medium text-green-900 underline">
                  Track the order →
                </Link>
              </div>
            ) : clientId ? (
              <PayPalScriptProvider options={{ clientId, intent: "authorize", currency: best.currency }}>
                <PayPalButtons
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
                    setHeld({ orderId: body.orderId, amount: best.agreedMinor / 100 });
                  }}
                  onError={(err) => setError(String(err))}
                />
              </PayPalScriptProvider>
            ) : (
              <p className="text-sm text-green-900">Set NEXT_PUBLIC_PAYPAL_CLIENT_ID to approve with PayPal.</p>
            )}
            {!held && clientId && (
              <div className="mt-3">
                <DemoLogin />
              </div>
            )}
            {error && <p className="mt-2 text-red-700">{error}</p>}
          </div>
        </section>
      )}
      {FINAL.has(status) && !best && (
        <p className="rounded-xl border border-neutral-300 bg-neutral-50 p-4">
          {status === "failed" ? "Something went wrong running the agents." : "No seller agreed within your budget. Nothing was charged."}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {snap.negotiations.map((n: Neg) => {
          const ts = bySeller.get(n.id) ?? [];
          const finalState = states[n.id]?.state ?? n.state;
          // During replay, show the final state only once that thread's last turn is back on screen.
          const total = turns.filter((t) => t.negotiation_id === n.id).length;
          const st = replay && ts.length < total ? (ts.length ? "COUNTERED" : "OPEN") : finalState;
          return (
            <section key={n.id} className="flex flex-col rounded-xl border border-neutral-200">
              <header className="border-b border-neutral-100 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">
                    {n.seller.name} · {n.seller.city}
                  </p>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-sm">{STATE_LABEL[st] ?? st}</span>
                </div>
                <p className="text-sm text-neutral-600">{n.listing.title}</p>
                <div className="mt-2 flex gap-4 text-sm">
                  <span>
                    Ask <b>{money(lastPrice(ts, "seller"), currency)}</b>
                  </span>
                  <span>
                    Bid <b>{money(lastPrice(ts, "buyer"), currency)}</b>
                  </span>
                  <span className="text-neutral-400">list {money(n.listing.listPrice, currency)}</span>
                </div>
                <OffersChart turns={ts} budget={snap.mandate.maxPrice} />
              </header>
              <ol className="flex-1 space-y-3 p-4">
                {ts.map((t) => (
                  <li key={t.id} className={t.from === "buyer" ? "pl-8" : t.from === "engine" ? "text-center" : "pr-8"}>
                    {t.from === "engine" ? (
                      <p className="text-sm text-neutral-500">{t.message}</p>
                    ) : (
                      <div className={`rounded-xl p-3 ${t.from === "buyer" ? "bg-blue-50" : "bg-neutral-100"}`}>
                        <p className="text-xs uppercase tracking-wide text-neutral-500">
                          {t.from === "buyer" ? `${snap.mandate.buyerName}'s agent` : `${n.seller.name}'s agent`} · round {t.round}
                          {t.source === "fallback" && " · rule-based"}
                        </p>
                        <p>{t.message}</p>
                        {t.final_price != null && <p className="mt-1 text-lg font-semibold">{money(t.final_price, currency)}</p>}
                        <GuardrailBadge t={t} />
                      </div>
                    )}
                  </li>
                ))}
                {!FINAL.has(status) && !["AGREED", "WALKED_AWAY", "EXPIRED", "BLOCKED_BY_GUARDRAIL"].includes(st) && (
                  <li className="text-sm text-neutral-400">typing…</li>
                )}
              </ol>
            </section>
          );
        })}
      </div>

    </main>
  );
}
