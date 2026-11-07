"use client";

// Seller dashboard on AG Grid Community: orders, negotiations and listings,
// money held vs captured, and captured revenue by week (AG Charts). Polls so
// rows update live and changed cells flash; clicking a negotiation opens its turns.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClickedEvent,
} from "ag-grid-community";
import { AgCharts } from "ag-charts-react";
import {
  BarSeriesModule,
  CategoryAxisModule,
  ModuleRegistry as ChartsModuleRegistry,
  NumberAxisModule,
  type AgCartesianChartOptions,
} from "ag-charts-community";
import { NegotiationChat } from "@/components/NegotiationChat";
import type { Dashboard } from "@/lib/dashboard/data";

ModuleRegistry.registerModules([AllCommunityModule]);
ChartsModuleRegistry.registerModules([BarSeriesModule, CategoryAxisModule, NumberAxisModule]);

type Order = Dashboard["orders"][number];
type Neg = Dashboard["negotiations"][number];
type Listing = Dashboard["listings"][number];
interface TurnRow {
  id: string;
  from: string;
  round: number;
  message: string;
  proposed: number | null;
  final: number | null;
  guardrail: string;
  injection: boolean;
  source: string;
}

const gbp = (n: number | null | undefined) =>
  n == null ? "–" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "–";

// Chip tone by meaning: progress (indigo), agreed (haldi), money safe/done (leaf),
// blocked (madder), closed (plain).
const TONE: Record<string, string> = {
  AUTHORIZED: "chip-safe",
  SHIPPED: "chip-progress",
  CAPTURED: "chip-safe",
  REFUNDED: "",
  VOIDED: "",
  OFFERED: "chip-progress",
  COUNTERED: "chip-progress",
  OPEN: "chip-progress",
  AGREED: "chip-agreed",
  AWAITING_BUYER_APPROVAL: "chip-agreed",
  ORDERED: "chip-safe",
  BLOCKED_BY_GUARDRAIL: "chip-bad",
  active: "chip-safe",
  sold: "chip-agreed",
};
const LABEL: Record<string, string> = {
  CREATED: "Unpaid",
  APPROVED: "Unpaid",
  AUTHORIZED: "Money held",
  CAPTURED: "Paid",
  VOIDED: "Cancelled",
  AWAITING_BUYER_APPROVAL: "Awaiting buyer",
  WALKED_AWAY: "Walked away",
  BLOCKED_BY_GUARDRAIL: "Blocked",
};

function StatusPill(p: ICellRendererParams) {
  const v = String(p.value ?? "");
  return <span className={`chip ${TONE[v] ?? ""}`}>{LABEL[v] ?? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase().replaceAll("_", " ")}</span>;
}

const money = { valueFormatter: (p: { value: number | null }) => gbp(p.value), type: "rightAligned" as const, width: 110 };
// The grid takes its colours from the design tokens, so it follows dark mode.
const theme = themeQuartz.withParams({
  fontFamily: "inherit",
  fontSize: 15,
  headerFontSize: 14,
  rowHeight: 48,
  headerHeight: 44,
  backgroundColor: "var(--raised)",
  foregroundColor: "var(--ink)",
  headerBackgroundColor: "var(--surface)",
  headerTextColor: "var(--ink-2)",
  borderColor: "var(--line)",
  rowHoverColor: "var(--surface)",
  accentColor: "var(--indigo)",
  wrapperBorderRadius: 14,
});

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<"orders" | "negotiations" | "listings">("orders");
  const [selected, setSelected] = useState<Neg | null>(null);
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [disputes, setDisputes] = useState<{
    available: boolean;
    count: number;
    items: { id: string; status: string; reason: string; amount: string | null; transactionId: string | null }[];
  } | null>(null);
  const [disputeNote, setDisputeNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/disputes")
      .then((r) => r.json())
      .then((b) => setDisputes({ available: b.available, count: b.disputes.length, items: b.disputes }))
      .catch(() => setDisputes(null));
  }, []);

  const [authError, setAuthError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/dashboard", { cache: "no-store" });
    if (res.ok) {
      const d = await res.json();
      // Unpaid orders (PayPal opened, never approved) need nothing from the seller.
      setData({ ...d, orders: d.orders.filter((o: Order) => o.status !== "CREATED" && o.status !== "APPROVED") });
    }
    else if (res.status === 401 || res.status === 403) setAuthError((await res.json()).error);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    fetch(`/api/negotiations/${selected.id}/turns`)
      .then((r) => r.json())
      .then((b) => setTurns(b.turns));
  }, [selected]);

  const orderCols = useMemo<ColDef<Order>[]>(
    () => [
      { field: "status", cellRenderer: StatusPill, width: 130, sort: "asc" },
      { field: "listing", flex: 2, minWidth: 220 },
      { field: "buyer", width: 110 },
      { field: "amount", ...money },
      { field: "marginAboveFloor", headerName: "Above floor", ...money, width: 120 },
      { field: "refunded", ...money },
      { headerName: "Tracking", valueGetter: (p) => (p.data?.tracking ? `${p.data.carrier} ${p.data.tracking}` : "–"), flex: 1, minWidth: 160 },
      { field: "authorizedAt", headerName: "Held on", valueFormatter: (p) => when(p.value), width: 110 },
      { field: "capturedAt", headerName: "Captured", valueFormatter: (p) => when(p.value), width: 110 },
      {
        headerName: "",
        width: 90,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<Order>) => (
          <Link href={`/order/${p.data?.id}`} className="link text-sm">
            Open
          </Link>
        ),
      },
    ],
    [],
  );

  const negCols = useMemo<ColDef<Neg>[]>(
    () => [
      { field: "state", cellRenderer: StatusPill, width: 150 },
      { field: "listing", flex: 2, minWidth: 220 },
      { field: "buyer", width: 110 },
      { field: "ask", headerName: "Your ask", ...money },
      { field: "bid", headerName: "Their bid", ...money },
      { field: "agreed", ...money },
      { field: "marginAboveFloor", headerName: "Above floor", ...money, width: 120 },
      { field: "rounds", width: 90, type: "rightAligned" },
      { field: "createdAt", headerName: "Started", valueFormatter: (p) => when(p.value), width: 110, sort: "desc" },
    ],
    [],
  );

  const listingCols = useMemo<ColDef<Listing>[]>(
    () => [
      {
        headerName: "",
        width: 80,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<Listing>) => (
          <Link href={`/listings/${p.data?.id}/edit`} className="link text-sm">
            Edit
          </Link>
        ),
      },
      { field: "status", cellRenderer: StatusPill, width: 110 },
      { field: "title", flex: 2, minWidth: 240 },
      { field: "category", width: 120 },
      { field: "listPrice", headerName: "List", ...money },
      { field: "floorPrice", headerName: "Floor (private)", ...money, width: 140 },
      { field: "negotiations", headerName: "Negotiations", width: 130, type: "rightAligned" },
      { field: "deals", width: 90, type: "rightAligned" },
      { field: "paypalProductId", headerName: "PayPal product", valueFormatter: (p) => p.value ?? "–", width: 170 },
      { field: "stock", width: 90, type: "rightAligned" },
    ],
    [],
  );

  // AG Charts draws on canvas, so read the token values once on the client.
  const [ink, setInk] = useState({ leaf: "#1e7a4c", text: "#4a5072", line: "#e2e4ee" });
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    setInk({ leaf: v("--leaf", "#1e7a4c"), text: v("--ink-2", "#4a5072"), line: v("--line", "#e2e4ee") });
  }, []);

  const chart = useMemo<AgCartesianChartOptions>(
    () => ({
      data: (data?.revenueByWeek ?? []).map((w) => ({
        week: new Date(w.week).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        captured: w.captured,
      })),
      series: [{ type: "bar", xKey: "week", yKey: "captured", yName: "Paid", fill: ink.leaf, cornerRadius: 6 }],
      axes: {
        x: { type: "category", position: "bottom", label: { color: ink.text }, line: { stroke: ink.line } },
        y: {
          type: "number",
          position: "left",
          label: { color: ink.text, formatter: (p: { value: number }) => `£${p.value}` },
          gridLine: { style: [{ stroke: ink.line }] },
        },
      },
      background: { visible: false },
      height: 220,
    }),
    [data?.revenueByWeek, ink],
  );

  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true, enableCellChangeFlash: true }), []);

  if (authError)
    return (
      <main className="page-narrow">
        <div className="panel p-6 sm:p-8">
          <h1 className="title text-2xl">{authError}</h1>
          <p className="mt-2 text-ink-2">The dashboard shows a seller&apos;s orders, negotiations and listings.</p>
          <Link href="/login?next=/dashboard" className="btn btn-primary mt-5">
            Log in as a seller
          </Link>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="page">
        <p className="text-ink-3" role="status">
          Loading dashboard…
        </p>
      </main>
    );

  const deals = data.negotiations.filter((n) => n.agreed != null && n.marginAboveFloor != null);
  const avgMargin = deals.length ? deals.reduce((a, n) => a + (n.marginAboveFloor ?? 0), 0) / deals.length : null;
  const toShip = data.orders.filter((o) => o.status === "AUTHORIZED");
  const stats = [
    { label: "Money held", value: gbp(data.tiles.held), note: "Paid by buyers, released when you ship", tone: "text-leaf" },
    { label: "Paid to you", value: gbp(data.tiles.captured), note: "After shipping, net of refunds", tone: "" },
    { label: "Refunded", value: gbp(data.tiles.refunded), note: "Returned to buyers", tone: "" },
    {
      label: "Open negotiations",
      value: String(data.tiles.activeNegotiations),
      note:
        data.tiles.awaitingBuyer === 0
          ? "Your agent is talking to buyers"
          : data.tiles.awaitingBuyer === data.tiles.activeNegotiations
            ? "Agreed, waiting for the buyer to pay"
            : `${data.tiles.awaitingBuyer} agreed, waiting for the buyer to pay`,
      tone: "",
    },
    { label: "Average above floor", value: avgMargin == null ? "–" : gbp(avgMargin), note: "How far above your floor your agent sold", tone: "" },
  ];
  const TAB_LABEL = { orders: "Orders", negotiations: "Negotiations", listings: "Listings" } as const;

  return (
    <main className="page space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-ink-3">Seller dashboard</p>
          <h1 className="title text-4xl">
            {data.seller.name}, {data.seller.city}
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/seller" className="btn btn-secondary">
            Phone view
          </Link>
          <Link href="/sell" className="btn btn-primary">
            List a new piece
          </Link>
        </div>
      </header>

      {toShip.length > 0 && (
        <section className="panel overflow-hidden" aria-labelledby="to-ship">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-leaf-soft px-5 py-3">
            <h2 id="to-ship" className="font-semibold text-leaf">
              {toShip.length === 1 ? "1 order to ship" : `${toShip.length} orders to ship`}
            </h2>
            <p className="text-sm text-leaf">The buyer&apos;s money is held. You&apos;re paid when you add tracking.</p>
          </div>
          <ul className="divide-y divide-line">
            {toShip.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{o.listing}</p>
                  <p className="text-sm text-ink-3">
                    For {o.buyer}, held on {when(o.authorizedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="money text-lg">{gbp(o.amount)}</span>
                  <Link href={`/order/${o.id}`} className="btn btn-primary btn-sm">
                    Ship it
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {disputes && disputes.items.length > 0 && (
        <section className="panel border-madder/40 p-5" aria-labelledby="disputes">
          <h2 id="disputes" className="font-semibold text-madder">
            {disputes.items.length === 1 ? "1 PayPal dispute" : `${disputes.items.length} PayPal disputes`}
          </h2>
          <p className="hint mt-1">Send PayPal the tracking and the negotiation record. It&apos;s often enough to close a dispute.</p>
          <ul className="mt-3 divide-y divide-line">
            {disputes.items.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">{d.reason.charAt(0) + d.reason.slice(1).toLowerCase().replaceAll("_", " ")}</p>
                  <p className="text-sm text-ink-3">
                    {d.id}
                    {d.amount ? `, ${d.amount}` : ""}, {d.status.toLowerCase().replaceAll("_", " ")}
                  </p>
                </div>
                {d.transactionId && (
                  <button
                    onClick={async () => {
                      const res = await fetch(`/api/disputes/${d.id}/evidence`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ transactionId: d.transactionId }),
                      });
                      setDisputeNote(res.ok ? `Evidence sent for ${d.id}.` : (await res.json()).error);
                    }}
                    className="btn btn-secondary btn-sm"
                  >
                    Send tracking and deal record
                  </button>
                )}
              </li>
            ))}
          </ul>
          {disputeNote && (
            <p role="status" className="mt-2 text-sm">
              {disputeNote}
            </p>
          )}
        </section>
      )}

      <section className="panel grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-x" aria-label="Summary">
        {stats.map((t, i) => (
          <div key={t.label} className={`p-4 sm:p-5 ${i === 0 ? "col-span-2 sm:col-span-1" : ""}`}>
            <p className="text-sm text-ink-3">{t.label}</p>
            <p className={`money mt-1 text-[1.75rem] leading-tight ${t.tone}`}>{t.value}</p>
            <p className="hint mt-1">{t.note}</p>
          </div>
        ))}
      </section>
      <p className="hint -mt-5">
        PayPal disputes:{" "}
        {disputes?.available ? `${disputes.count} open, checked through the PayPal Agent Toolkit.` : "not checked (needs PayPal keys)."}
      </p>

      <section>
        <div className="mb-3 flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Seller records">
          {(["orders", "negotiations", "listings"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 font-semibold ${
                tab === t ? "border-indigo text-indigo" : "border-transparent text-ink-2 hover:text-ink"
              }`}
            >
              {TAB_LABEL[t]} <span className="money ml-1 text-sm text-ink-3">{data[t].length}</span>
            </button>
          ))}
        </div>
        {tab === "negotiations" && !selected && <p className="hint mb-3">Select a negotiation to read what the agents said.</p>}

        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0 overflow-x-auto">
            <div style={{ minWidth: 640 }}>
              {tab === "orders" && (
                <AgGridReact<Order> theme={theme} rowData={data.orders} columnDefs={orderCols} defaultColDef={defaultColDef} domLayout="autoHeight" getRowId={(p) => p.data.id} />
              )}
              {tab === "negotiations" && (
                <AgGridReact<Neg>
                  theme={theme}
                  rowData={data.negotiations}
                  columnDefs={negCols}
                  defaultColDef={defaultColDef}
                  domLayout="autoHeight"
                  getRowId={(p) => p.data.id}
                  onRowClicked={(e: RowClickedEvent<Neg>) => setSelected(e.data ?? null)}
                  rowClass="cursor-pointer"
                />
              )}
              {tab === "listings" && (
                <AgGridReact<Listing> theme={theme} rowData={data.listings} columnDefs={listingCols} defaultColDef={defaultColDef} domLayout="autoHeight" getRowId={(p) => p.data.id} />
              )}
            </div>
          </div>

          {tab === "negotiations" && selected && (
            <aside className="panel w-full p-4 lg:w-96" aria-label="Negotiation transcript">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">With {selected.buyer}&apos;s agent</p>
                  <p className="text-sm text-ink-3">{selected.listing}</p>
                </div>
                <button onClick={() => setSelected(null)} className="btn btn-quiet btn-sm" aria-label="Close transcript">
                  Close
                </button>
              </div>
              {turns.length === 0 ? (
                <p className="text-sm text-ink-3">No messages recorded.</p>
              ) : (
                <NegotiationChat
                  scroll
                  lines={turns.map((t) => {
                    if (t.from === "engine") return { id: t.id, from: "engine" as const, text: t.message, price: null, blocked: t.guardrail.startsWith("REJECTED") };
                    const notes: string[] = [];
                    if (t.injection) notes.push("Injection attempt ignored");
                    if (t.source === "fallback") notes.push("Rule-based reply");
                    if (t.proposed != null && t.final != null && t.proposed !== t.final) notes.push(`Engine adjusted from ${gbp(t.proposed)}`);
                    return { id: t.id, from: t.from as "seller" | "buyer", text: t.message, price: t.final, notes };
                  })}
                  left="Your agent"
                  right={`${selected.buyer}'s agent`}
                />
              )}
              <p className="hint mt-3">Only your conversation is shown. The buyer&apos;s budget and other sellers stay private.</p>
            </aside>
          )}
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="font-semibold">Paid to you, by week</h2>
        <AgCharts options={chart} />
      </section>
    </main>
  );
}
