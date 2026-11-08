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
import { useThemeChange } from "@/components/ThemeToggle";
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

// PayPal payout states, in plain words.
const PAYOUT_LABEL: Record<string, string> = {
  SENDING: "sending",
  PENDING: "on its way",
  PROCESSING: "on its way",
  SUCCESS: "in your PayPal",
  UNCLAIMED: "waiting for you to claim it",
  ONHOLD: "on hold at PayPal",
  RETURNED: "returned",
  BLOCKED: "blocked by PayPal",
};

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
  fontSize: 13.5,
  headerFontSize: 12.5,
  headerFontWeight: 600,
  rowHeight: 46,
  headerHeight: 40,
  backgroundColor: "var(--raised)",
  foregroundColor: "var(--ink)",
  headerBackgroundColor: "var(--surface)",
  headerTextColor: "var(--ink-3)",
  borderColor: "var(--line)",
  rowBorder: { color: "var(--line)" },
  rowHoverColor: "var(--surface)",
  accentColor: "var(--indigo)",
  wrapperBorderRadius: 12,
  cellHorizontalPadding: 16,
});

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<"orders" | "negotiations" | "listings" | "custom" | "statement">("orders");
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
        headerName: "Paid to you",
        valueGetter: (p) => p.data?.payout ?? null,
        valueFormatter: (p) => {
          const o = p.data;
          if (!o?.payoutStatus) return "–";
          if (o.payoutStatus === "FAILED") return "Payout failed";
          return `${gbp(o.payout ?? 0)} · ${PAYOUT_LABEL[o.payoutStatus] ?? o.payoutStatus.toLowerCase()}`;
        },
        tooltipValueGetter: (p) => (p.data?.payoutError ? p.data.payoutError : p.data?.payoutBatchId ? `PayPal payout ${p.data.payoutBatchId}, fee ${gbp(p.data.fee ?? 0)}` : null),
        width: 190,
      },
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

  // AG Charts draws on canvas, so read the token values on the client, and
  // again whenever the theme changes.
  const [ink, setInk] = useState({ leaf: "#1e7a4c", text: "#4a5072", line: "#e2e4ee" });
  const readInk = useCallback(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    setInk({ leaf: v("--leaf", "#1e7a4c"), text: v("--ink-2", "#4a5072"), line: v("--line", "#e2e4ee") });
  }, []);
  useEffect(readInk, [readInk]);
  useThemeChange(readInk);

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
      <main className="page space-y-6" aria-busy="true">
        <p className="sr-only" role="status">
          Loading dashboard…
        </p>
        <div className="h-4 w-32 animate-pulse rounded bg-surface" />
        <div className="h-9 w-80 animate-pulse rounded-lg bg-surface" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-xl bg-surface" />
      </main>
    );

  const deals = data.negotiations.filter((n) => n.agreed != null && n.marginAboveFloor != null);
  const avgMargin = deals.length ? deals.reduce((a, n) => a + (n.marginAboveFloor ?? 0), 0) / deals.length : null;
  const toShip = data.orders.filter((o) => o.status === "AUTHORIZED");
  const stats = [
    { label: "Money held", value: gbp(data.tiles.held), note: "Paid by buyers, released when you ship", tone: data.tiles.held > 0 ? "text-leaf" : "" },
    {
      label: "Paid to you",
      value: gbp(data.tiles.paidOut),
      note: data.tiles.payoutDebt > 0 ? `Sent to your PayPal; ${gbp(data.tiles.payoutDebt)} of refunds comes off the next one` : "Sent to your PayPal after shipping, minus Mandix's fee",
      tone: "",
    },
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
  const TAB_LABEL = { orders: "Orders", negotiations: "Negotiations", listings: "Listings", custom: "Custom orders", statement: "PayPal statement" } as const;

  return (
    <main className="page space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="eyebrow">Seller dashboard</p>
          <h1 className="title mt-2 text-[1.75rem]" aria-label={`${data.seller.name}, ${data.seller.city}`}>
            {data.seller.name}
            <span className="ml-2 text-lg font-normal text-ink-3">{data.seller.city}</span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/seller" className="btn btn-secondary">
            Phone view
          </Link>
          <Link href="/sell" className="btn btn-primary">
            List a new piece
          </Link>
        </div>
      </header>

      {data.seller.canBePaid === false && (
        <p className="notice flex flex-wrap items-center justify-between gap-3">
          <span>Connect a PayPal account so Mandix can pay you. No account? You can create one without leaving Mandix.</span>
          <Link href="/agent#getting-paid" className="btn btn-primary">
            Connect PayPal
          </Link>
        </p>
      )}

      {toShip.length > 0 && (
        <section className="panel overflow-hidden" aria-labelledby="to-ship">
          <div className="panel-head bg-leaf-soft">
            <h2 id="to-ship" className="flex items-center gap-2 text-sm font-semibold text-leaf">
              <span className="h-2 w-2 rounded-full bg-leaf" aria-hidden="true" />
              {toShip.length === 1 ? "1 order to ship" : `${toShip.length} orders to ship`}
            </h2>
            <p className="text-sm text-leaf">The buyer&apos;s money is held. You&apos;re paid when you add tracking.</p>
          </div>
          <ul className="divide-y divide-line">
            {toShip.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{o.listing}</p>
                  <p className="text-sm text-ink-3">
                    For {o.buyer}, held on {when(o.authorizedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="stat-value text-base">{gbp(o.amount)}</span>
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

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Summary">
        {stats.map((t, i) => (
          <div key={t.label} className={`panel p-4 sm:p-5 ${i === 0 ? "col-span-2 sm:col-span-1" : ""}`}>
            <p className="stat-label">{t.label}</p>
            <p className={`stat-value mt-2 text-[1.625rem] leading-none ${t.tone}`}>{t.value}</p>
            <p className="hint mt-2.5">{t.note}</p>
          </div>
        ))}
      </section>
      {disputes?.available && disputes.count === 0 && (
        <p className="hint -mt-2 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-leaf" aria-hidden="true" />
          No open PayPal disputes
        </p>
      )}

      <section className="space-y-3">
        <div
          className="inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1"
          role="tablist"
          aria-label="Seller records"
        >
          {(["orders", "negotiations", "listings", "custom", "statement"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t ? "bg-raised text-ink shadow-[var(--shadow-sm)]" : "text-ink-2 hover:text-ink"
              }`}
            >
              {TAB_LABEL[t]}
              {t !== "custom" && t !== "statement" && (
                <span className={`num rounded px-1.5 text-xs ${tab === t ? "bg-surface text-ink-2" : "text-ink-3"}`}>{data[t].length}</span>
              )}
            </button>
          ))}
        </div>
        {tab === "negotiations" && !selected && <p className="hint">Select a negotiation to read what the agents said.</p>}

        {tab === "custom" && <SellerCommissions />}
        {tab === "statement" && <Statement theme={theme} />}
        <div className={`grid gap-4 lg:grid-cols-[1fr_auto] ${tab === "custom" || tab === "statement" ? "hidden" : ""}`}>
          {/* Phones get simple cards; the full grid starts at tablet width. */}
          <ul className="space-y-2 sm:hidden">
            {tab === "orders" &&
              data.orders.map((o) => (
                <MobileRow
                  key={o.id}
                  href={`/order/${o.id}`}
                  title={o.listing}
                  meta={`${o.buyer} · held ${when(o.authorizedAt)}`}
                  status={o.status}
                  amount={gbp(o.amount)}
                />
              ))}
            {tab === "negotiations" &&
              data.negotiations.map((n) => (
                <MobileRow
                  key={n.id}
                  onClick={() => setSelected(n)}
                  title={n.listing}
                  meta={`${n.buyer} · ${n.rounds} rounds · started ${when(n.createdAt)}`}
                  status={n.state}
                  amount={gbp(n.agreed ?? n.ask)}
                />
              ))}
            {tab === "listings" &&
              data.listings.map((l) => (
                <MobileRow
                  key={l.id}
                  href={`/listings/${l.id}/edit`}
                  title={l.title}
                  meta={`Floor ${gbp(l.floorPrice)} · ${l.negotiations} negotiations · ${l.stock} in stock`}
                  status={l.status}
                  amount={gbp(l.listPrice)}
                />
              ))}
            {data[tab as "orders" | "negotiations" | "listings"]?.length === 0 && (
              <li className="well p-5 text-center text-sm text-ink-3">Nothing here yet.</li>
            )}
          </ul>
          <div className="hidden min-w-0 overflow-x-auto sm:block">
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
            <aside className="panel panel-raised w-full p-4 lg:w-96" aria-label="Negotiation transcript">
              <div className="mb-3 flex items-start justify-between gap-2 border-b border-line pb-3">
                <div>
                  <p className="text-sm font-semibold">With {selected.buyer}&apos;s agent</p>
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

      <section className="panel overflow-hidden">
        <div className="panel-head">
          <div>
            <h2 className="text-sm font-semibold">Paid to you, by week</h2>
            <p className="hint">Payments released to you after shipping</p>
          </div>
          <span className="stat-value text-base">{gbp(data.tiles.paidOut)}</span>
        </div>
        <div className="p-5">
          <AgCharts options={chart} />
        </div>
      </section>
    </main>
  );
}

function MobileRow({
  title,
  meta,
  status,
  amount,
  href,
  onClick,
}: {
  title: string;
  meta: string;
  status: string;
  amount: string;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-3">{meta}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="stat-value text-sm">{amount}</span>
        <span className={`chip ${TONE[status] ?? ""}`}>
          {LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replaceAll("_", " ")}
        </span>
      </span>
    </>
  );
  const cls = "panel flex w-full items-center gap-3 p-3.5 text-left hover:border-line-strong";
  return (
    <li>
      {href ? (
        <Link href={href} className={cls}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={cls}>
          {body}
        </button>
      )}
    </li>
  );
}

interface SellerCommission {
  id: string;
  title: string;
  buyer: string;
  request: string;
  price: number | null;
  readyInDays: number;
  agentNote: string;
  status: string;
}

/** Custom-order requests for this seller: approve sends a PayPal invoice (same as replying "yes" on WhatsApp). */
function SellerCommissions() {
  const [items, setItems] = useState<SellerCommission[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    fetch("/api/commissions")
      .then((r) => r.json())
      .then((b) => setItems(b.commissions ?? []));
  useEffect(() => {
    load();
  }, []);
  async function act(id: string, action: "approve" | "decline") {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/commissions/${id}/${action}`, { method: "POST" });
    setBusy(null);
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "That didn't work. Try again.");
    load();
  }
  if (!items) return <div className="h-24 animate-pulse rounded-[1.25rem] bg-surface" />;
  if (items.length === 0)
    return (
      <p className="well p-5 text-ink-2">
        No custom requests yet. Buyers can ask for a made-to-order piece on any of your listings; you approve the price here or by replying on WhatsApp.
      </p>
    );
  return (
    <div className="space-y-3">
      {error && <p className="notice notice-bad">{error}</p>}
      <ul className="panel divide-y divide-line">
        {items.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
            <div className="min-w-0 max-w-xl space-y-1">
              <p className="font-semibold">
                {c.buyer} asks for: <span className="font-normal">&ldquo;{c.request}&rdquo;</span>
              </p>
              <p className="text-sm text-ink-3">
                Based on {c.title}. Your agent suggests {c.price != null ? gbp(c.price) : "–"}, ready in {c.readyInDays} days.
              </p>
            </div>
            {c.status === "AWAITING_SELLER" ? (
              <div className="flex gap-2">
                <button className="btn btn-primary btn-sm" disabled={busy === c.id} onClick={() => act(c.id, "approve")}>
                  {busy === c.id ? "Sending invoice…" : "Approve and send PayPal invoice"}
                </button>
                <button className="btn btn-quiet btn-sm" disabled={busy === c.id} onClick={() => act(c.id, "decline")}>
                  Decline
                </button>
              </div>
            ) : (
              <span className={`chip ${c.status === "PAID" ? "chip-safe" : c.status === "INVOICED" ? "chip-agreed" : ""}`}>
                {c.status === "PAID" ? "Paid: start making it" : c.status === "INVOICED" ? "Invoice sent" : c.status === "DECLINED" ? "Declined" : c.status}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface StatementLine {
  id: string;
  date: string;
  type: string;
  amount: number;
  currency: string;
  paypalStatus: string;
  listing: string | null;
  mandixAmount: number | null;
  matches: boolean | null;
}

/** PayPal's own statement for this seller (Transaction Search via the Agent Toolkit), checked against Mandix's records. */
function Statement({ theme }: { theme: ReturnType<typeof themeQuartz.withParams> }) {
  const [data, setData] = useState<{ lines: StatementLine[]; unmatched: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/dashboard/statement").then(async (r) => (r.ok ? setData(await r.json()) : setError((await r.json().catch(() => ({}))).error ?? "Couldn't load")));
  }, []);
  const cols = useMemo<ColDef<StatementLine>[]>(
    () => [
      { field: "date", valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "–"), width: 150, sort: "desc" },
      { field: "type", flex: 1, minWidth: 170 },
      { field: "listing", flex: 1, minWidth: 180, valueFormatter: (p) => p.value ?? "–" },
      { field: "amount", headerName: "PayPal", type: "rightAligned", width: 120, valueFormatter: (p) => new Intl.NumberFormat("en-GB", { style: "currency", currency: p.data?.currency ?? "GBP" }).format(p.value ?? 0) },
      { field: "mandixAmount", headerName: "Mandix", type: "rightAligned", width: 110, valueFormatter: (p) => (p.value == null ? "–" : gbp(p.value)) },
      { field: "matches", headerName: "Agrees", width: 100, valueFormatter: (p) => (p.value == null ? "–" : p.value ? "✓" : "Check") },
      { field: "paypalStatus", headerName: "Status", width: 120 },
    ],
    [],
  );
  if (error) return <p className="notice">{error}</p>;
  if (!data) return <div className="h-24 animate-pulse rounded-[1.25rem] bg-surface" />;
  return (
    <div className="space-y-3">
      <p className="hint">
        From PayPal&apos;s Transaction Search (last 30 days), checked line by line against Mandix&apos;s records. New payments can take up to three hours to appear
        here.
      </p>
      {data.lines.length === 0 ? (
        <p className="well p-5 text-ink-2">PayPal hasn&apos;t listed any of your transactions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: 760 }}>
            <AgGridReact<StatementLine> theme={theme} rowData={data.lines} columnDefs={cols} domLayout="autoHeight" getRowId={(p) => p.data.id} />
          </div>
        </div>
      )}
    </div>
  );
}
