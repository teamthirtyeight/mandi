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
  n == null ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";

const PILL: Record<string, string> = {
  CREATED: "bg-neutral-100 text-neutral-700",
  APPROVED: "bg-neutral-100 text-neutral-700",
  AUTHORIZED: "bg-amber-100 text-amber-900",
  SHIPPED: "bg-blue-100 text-blue-900",
  CAPTURED: "bg-green-100 text-green-900",
  REFUNDED: "bg-purple-100 text-purple-900",
  VOIDED: "bg-neutral-200 text-neutral-600",
  OPEN: "bg-neutral-100 text-neutral-700",
  OFFERED: "bg-blue-100 text-blue-900",
  COUNTERED: "bg-blue-100 text-blue-900",
  AGREED: "bg-green-100 text-green-900",
  AWAITING_BUYER_APPROVAL: "bg-amber-100 text-amber-900",
  ORDERED: "bg-green-100 text-green-900",
  WALKED_AWAY: "bg-neutral-200 text-neutral-600",
  EXPIRED: "bg-neutral-200 text-neutral-600",
  BLOCKED_BY_GUARDRAIL: "bg-red-100 text-red-900",
  active: "bg-green-100 text-green-900",
};
const LABEL: Record<string, string> = { AUTHORIZED: "Held", AWAITING_BUYER_APPROVAL: "Awaiting buyer", WALKED_AWAY: "Walked away" };

function StatusPill(p: ICellRendererParams) {
  const v = String(p.value ?? "");
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PILL[v] ?? "bg-neutral-100"}`}>
      {LABEL[v] ?? v.charAt(0) + v.slice(1).toLowerCase().replaceAll("_", " ")}
    </span>
  );
}

const money = { valueFormatter: (p: { value: number | null }) => gbp(p.value), type: "rightAligned" as const, width: 110 };
const theme = themeQuartz.withParams({ fontSize: 15, headerFontSize: 14, rowHeight: 44 });

export default function DashboardPage() {
  const [sellers, setSellers] = useState<{ id: string; name: string; city: string }[]>([]);
  const [sellerId, setSellerId] = useState<string>("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<"orders" | "negotiations" | "listings">("orders");
  const [selected, setSelected] = useState<Neg | null>(null);
  const [turns, setTurns] = useState<TurnRow[]>([]);
  const [disputes, setDisputes] = useState<{ available: boolean; count: number } | null>(null);

  useEffect(() => {
    fetch("/api/disputes")
      .then((r) => r.json())
      .then((b) => setDisputes({ available: b.available, count: b.disputes.length }))
      .catch(() => setDisputes(null));
  }, []);

  useEffect(() => {
    fetch("/api/sellers")
      .then((r) => r.json())
      .then((b) => {
        setSellers(b.sellers);
        if (b.sellers[0]) setSellerId(b.sellers[0].id);
      });
  }, []);

  const load = useCallback(async () => {
    if (!sellerId) return;
    const res = await fetch(`/api/dashboard?sellerId=${sellerId}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [sellerId]);

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
      { headerName: "Tracking", valueGetter: (p) => (p.data?.tracking ? `${p.data.carrier} ${p.data.tracking}` : "—"), flex: 1, minWidth: 160 },
      { field: "authorizedAt", headerName: "Held on", valueFormatter: (p) => when(p.value), width: 110 },
      { field: "capturedAt", headerName: "Captured", valueFormatter: (p) => when(p.value), width: 110 },
      {
        headerName: "",
        width: 90,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<Order>) => (
          <Link href={`/order/${p.data?.id}`} className="text-sm underline">
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
      { field: "status", cellRenderer: StatusPill, width: 110 },
      { field: "title", flex: 2, minWidth: 240 },
      { field: "category", width: 120 },
      { field: "listPrice", headerName: "List", ...money },
      { field: "floorPrice", headerName: "Floor (private)", ...money, width: 140 },
      { field: "negotiations", headerName: "Negotiations", width: 130, type: "rightAligned" },
      { field: "deals", width: 90, type: "rightAligned" },
      { field: "paypalProductId", headerName: "PayPal product", valueFormatter: (p) => p.value ?? "—", width: 170 },
    ],
    [],
  );

  const chart = useMemo<AgCartesianChartOptions>(
    () => ({
      data: (data?.revenueByWeek ?? []).map((w) => ({
        week: new Date(w.week).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        captured: w.captured,
      })),
      series: [{ type: "bar", xKey: "week", yKey: "captured", yName: "Captured", fill: "#15803d", cornerRadius: 4 }],
      axes: {
        x: { type: "category", position: "bottom" },
        y: { type: "number", position: "left", label: { formatter: (p: { value: number }) => `£${p.value}` } },
      },
      background: { visible: false },
      height: 220,
    }),
    [data?.revenueByWeek],
  );

  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, resizable: true, enableCellChangeFlash: true }), []);

  if (!data) return <main className="p-8 text-neutral-500">Loading dashboard…</main>;

  const deals = data.negotiations.filter((n) => n.agreed != null && n.marginAboveFloor != null);
  const avgMargin = deals.length ? deals.reduce((a, n) => a + (n.marginAboveFloor ?? 0), 0) / deals.length : null;
  const tiles = [
    { label: "Money held", value: gbp(data.tiles.held), note: "Authorized, waiting for you to ship" },
    { label: "Captured", value: gbp(data.tiles.captured), note: "Paid out after shipping, net of refunds" },
    { label: "Refunded", value: gbp(data.tiles.refunded), note: "Returned to buyers" },
    { label: "Live negotiations", value: String(data.tiles.activeNegotiations), note: "Your agent is talking to buyers" },
    { label: "Avg. above floor", value: avgMargin == null ? "—" : gbp(avgMargin), note: "How far your agent sold above your floor" },
    {
      label: "PayPal disputes",
      value: disputes?.available ? String(disputes.count) : "—",
      note: disputes?.available ? "Open disputes via the Agent Toolkit" : "Needs PayPal keys",
    },
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-neutral-500">Seller dashboard</p>
          <h1 className="text-3xl font-semibold">
            {data.seller.name} · {data.seller.city}
          </h1>
        </div>
        <Link href={`/seller/${sellerId}`} className="text-sm underline">
          Open {data.seller.name}&apos;s phone view
        </Link>
        <select
          className="rounded-lg border border-neutral-300 px-3 py-2"
          value={sellerId}
          onChange={(e) => {
            setSellerId(e.target.value);
            setSelected(null);
          }}
          aria-label="Seller"
        >
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.city}
            </option>
          ))}
        </select>
      </header>

      <section className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-neutral-200 p-4">
            <p className="text-sm text-neutral-500">{t.label}</p>
            <p className="text-[28px] font-semibold">{t.value}</p>
            <p className="text-xs text-neutral-500">{t.note}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-neutral-200 p-4">
        <p className="mb-2 font-medium">Captured revenue by week</p>
        <AgCharts options={chart} />
      </section>

      <section>
        <div className="mb-3 flex gap-2">
          {(["orders", "negotiations", "listings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-4 py-2 capitalize ${tab === t ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}
            >
              {t} ({data[t].length})
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div style={{ height: 420 }}>
            {tab === "orders" && (
              <AgGridReact<Order> theme={theme} rowData={data.orders} columnDefs={orderCols} defaultColDef={defaultColDef} getRowId={(p) => p.data.id} />
            )}
            {tab === "negotiations" && (
              <AgGridReact<Neg>
                theme={theme}
                rowData={data.negotiations}
                columnDefs={negCols}
                defaultColDef={defaultColDef}
                getRowId={(p) => p.data.id}
                onRowClicked={(e: RowClickedEvent<Neg>) => setSelected(e.data ?? null)}
                rowClass="cursor-pointer"
              />
            )}
            {tab === "listings" && (
              <AgGridReact<Listing> theme={theme} rowData={data.listings} columnDefs={listingCols} defaultColDef={defaultColDef} getRowId={(p) => p.data.id} />
            )}
          </div>

          {tab === "negotiations" && selected && (
            <aside className="max-h-[420px] w-full overflow-y-auto rounded-xl border border-neutral-200 p-4 lg:w-96">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{selected.buyer}&apos;s agent</p>
                  <p className="text-sm text-neutral-600">{selected.listing}</p>
                </div>
                <button onClick={() => setSelected(null)} className="text-sm text-neutral-500" aria-label="Close">
                  ✕
                </button>
              </div>
              {turns.length === 0 ? (
                <p className="text-sm text-neutral-500">No turns recorded.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {turns.map((t) => (
                    <li key={t.id} className={`rounded-lg p-2 ${t.from === "buyer" ? "bg-blue-50" : t.from === "seller" ? "bg-neutral-100" : ""}`}>
                      <p className="text-xs uppercase text-neutral-500">
                        {t.from} · round {t.round}
                        {t.source === "fallback" && " · rule-based"}
                      </p>
                      <p>{t.message}</p>
                      {t.final != null && (
                        <p className="font-semibold">
                          {gbp(t.final)}
                          {t.proposed != null && t.proposed !== t.final && (
                            <span className="ml-2 text-xs font-normal text-amber-800">engine adjusted from {gbp(t.proposed)}</span>
                          )}
                        </p>
                      )}
                      {t.injection && <p className="text-xs text-amber-800">Injection attempt ignored</p>}
                    </li>
                  ))}
                </ol>
              )}
              <Link href={`/deal/${selected.mandateId}`} className="mt-3 inline-block text-sm underline">
                Open negotiation room →
              </Link>
            </aside>
          )}
        </div>
      </section>
    </main>
  );
}
