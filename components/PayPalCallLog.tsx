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
    <aside className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="mb-3 font-semibold">PayPal API calls</h2>
      {events.length === 0 ? (
        <p className="text-sm text-neutral-500">No calls yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="border-b border-neutral-100 pb-2">
              <div className="flex justify-between gap-3 font-mono">
                <span className="truncate">
                  {e.direction === "webhook" ? "WEBHOOK " : `${e.method ?? ""} `}
                  {e.endpoint}
                </span>
                <span className={e.httpStatus && e.httpStatus < 300 ? "text-green-700" : "text-red-700"}>
                  {e.httpStatus}
                </span>
              </div>
              <div className="flex justify-between gap-3 text-neutral-600">
                <span>{e.summary}</span>
                <span className="shrink-0 text-neutral-400">{new Date(e.createdAt).toLocaleTimeString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
