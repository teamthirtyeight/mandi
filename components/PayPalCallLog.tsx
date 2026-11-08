"use client";

// Docked "PayPal API calls" panel: every call and webhook from paypal_events,
// newest first. Polls so judges see calls land as they happen.
import { useCallback, useEffect, useState } from "react";

interface PaypalEvent {
  id: string;
  direction: "call" | "webhook";
  method: string | null;
  endpoint: string;
  httpStatus: number | null;
  summary: string;
  createdAt: string;
}

export function PayPalCallLog({ orderId, refreshKey = 0 }: { orderId?: string; refreshKey?: number }) {
  const [events, setEvents] = useState<PaypalEvent[]>([]);

  const load = useCallback(async () => {
    const qs = orderId ? `?orderId=${orderId}` : "";
    const res = await fetch(`/api/paypal/events${qs}`, { cache: "no-store" });
    if (res.ok) setEvents((await res.json()).events);
  }, [orderId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  return (
    <aside className="p-5" aria-label="PayPal API calls">
      <h2 className="title text-lg">PayPal API calls</h2>
      <p className="hint mb-3">Every request Mandix makes to PayPal, newest first.</p>
      {events.length === 0 ? (
        <p className="well px-3 py-2 text-sm text-ink-3">No calls yet. They appear here as soon as money moves.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {events.map((e) => {
            const ok = e.httpStatus != null && e.httpStatus < 300;
            return (
              <li key={e.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold">{e.summary}</p>
                  <span className={`chip shrink-0 ${ok ? "chip-safe" : "chip-bad"}`}>{e.httpStatus ?? "–"}</span>
                </div>
                <div className="mt-0.5 flex justify-between gap-3 text-xs text-ink-3">
                  <span className="truncate font-mono">
                    {e.direction === "webhook" ? "Webhook " : `${e.method ?? ""} `}
                    {e.endpoint}
                  </span>
                  <time className="money shrink-0 font-normal">{new Date(e.createdAt).toLocaleTimeString()}</time>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
