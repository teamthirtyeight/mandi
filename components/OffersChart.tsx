"use client";

// Per-seller offers chart: seller asks (solid, ink) and buyer bids (indigo) by
// round, with the buyer's budget as a dashed haldi line (seller grey, buyer in the brand colour), so convergence is
// visible. The chart draws on a canvas, so colours are read from the CSS tokens
// at runtime and re-read when the colour scheme changes.
import { useEffect, useMemo, useState } from "react";
import { AgCharts } from "ag-charts-react";
import {
  CategoryAxisModule,
  LineSeriesModule,
  ModuleRegistry,
  NumberAxisModule,
  type AgCartesianChartOptions,
} from "ag-charts-community";

import { THEME_EVENT } from "./ThemeToggle";

ModuleRegistry.registerModules([LineSeriesModule, CategoryAxisModule, NumberAxisModule]);

interface Point {
  from: string;
  round: number;
  final_price: number | null;
}

const FALLBACK = { ink: "#151935", ink3: "#6b7194", indigo: "#2f3fa0", haldi: "#e9a21b", line: "#e2e4ee" };

function useTokens() {
  const [tokens, setTokens] = useState(FALLBACK);
  useEffect(() => {
    const read = () => {
      const css = getComputedStyle(document.documentElement);
      const v = (name: string, fb: string) => css.getPropertyValue(name).trim() || fb;
      setTokens({
        ink: v("--ink", FALLBACK.ink),
        ink3: v("--ink-3", FALLBACK.ink3),
        indigo: v("--indigo", FALLBACK.indigo),
        haldi: v("--haldi", FALLBACK.haldi),
        line: v("--line", FALLBACK.line),
      });
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    window.addEventListener(THEME_EVENT, read);
    return () => {
      mq.removeEventListener("change", read);
      window.removeEventListener(THEME_EVENT, read);
    };
  }, []);
  return tokens;
}

export function OffersChart({ turns, budget }: { turns: Point[]; budget: number }) {
  const c = useTokens();
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
    const label = { color: c.ink3, fontFamily: "inherit", fontSize: 12 };
    return {
      data,
      height: 140,
      padding: { top: 8, right: 8, bottom: 4, left: 4 },
      background: { visible: false },
      legend: { enabled: false },
      animation: { enabled: false },
      series: [
        { type: "line", xKey: "round", yKey: "ask", yName: "Seller asks", stroke: c.ink3, strokeWidth: 2, marker: { fill: c.ink3, stroke: c.ink3, size: 6 } },
        { type: "line", xKey: "round", yKey: "bid", yName: "Your agent offers", stroke: c.indigo, strokeWidth: 2, marker: { fill: c.indigo, stroke: c.indigo, size: 6 } },
        { type: "line", xKey: "round", yKey: "budget", yName: "Your budget", stroke: c.haldi, strokeWidth: 2, lineDash: [5, 4], marker: { enabled: false } },
      ],
      axes: {
        x: { type: "category", position: "bottom", label, line: { stroke: c.line } },
        y: {
          type: "number",
          position: "left",
          label: { ...label, formatter: (p: { value: number }) => `£${p.value}` },
          gridLine: { style: [{ stroke: c.line, lineDash: [2, 3] }] },
        },
      },
    };
  }, [turns, budget, c]);

  if (!turns.some((t) => t.final_price != null)) return null;
  return (
    <div>
      <AgCharts options={options} />
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3" aria-hidden="true">
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded bg-ink-3" />
          Seller
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0.5 w-3.5 rounded bg-indigo" />
          Your agent
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-0 w-3.5 border-t-2 border-dashed border-haldi" />
          Budget
        </li>
      </ul>
    </div>
  );
}
