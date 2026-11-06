"use client";

// Per-seller offers chart: seller asks (solid) and buyer bids (dashed) by
// round, with the buyer's budget as a flat line, so convergence is visible.
import { useMemo } from "react";
import { AgCharts } from "ag-charts-react";
import {
  CategoryAxisModule,
  LineSeriesModule,
  ModuleRegistry,
  NumberAxisModule,
  type AgCartesianChartOptions,
} from "ag-charts-community";

ModuleRegistry.registerModules([LineSeriesModule, CategoryAxisModule, NumberAxisModule]);

interface Point {
  from: string;
  round: number;
  final_price: number | null;
}

export function OffersChart({ turns, budget }: { turns: Point[]; budget: number }) {
  const options = useMemo<AgCartesianChartOptions>(() => {
    const rounds = new Map<number, { round: string; ask?: number; bid?: number; budget: number }>();
    for (const t of turns) {
      if (t.final_price == null || (t.from !== "buyer" && t.from !== "seller")) continue;
      const row = rounds.get(t.round) ?? { round: `R${t.round}`, budget };
      if (t.from === "seller") row.ask = t.final_price;
      else row.bid = t.final_price;
      rounds.set(t.round, row);
    }
    const data = [...rounds.values()];
    return {
      data,
      height: 140,
      padding: { top: 8, right: 8, bottom: 4, left: 4 },
      background: { visible: false },
      legend: { enabled: false },
      animation: { enabled: false },
      series: [
        { type: "line", xKey: "round", yKey: "ask", yName: "Seller ask", stroke: "#404040", marker: { fill: "#404040", size: 6 } },
        { type: "line", xKey: "round", yKey: "bid", yName: "Buyer bid", stroke: "#2563eb", lineDash: [4, 3], marker: { fill: "#2563eb", size: 6 } },
        { type: "line", xKey: "round", yKey: "budget", yName: "Budget", stroke: "#d97706", lineDash: [2, 4], marker: { enabled: false } },
      ],
      axes: {
        x: { type: "category", position: "bottom" },
        y: { type: "number", position: "left", label: { formatter: (p: { value: number }) => `£${p.value}` } },
      },
    };
  }, [turns, budget]);

  if (!turns.some((t) => t.final_price != null)) return null;
  return <AgCharts options={options} />;
}
