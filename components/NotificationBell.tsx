"use client";

// Bell in the nav: unread count, the latest notifications, and (after the user
// allows it) a system notification whenever a new one arrives.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Item {
  id: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/notifications", { cache: "no-store" });
    if (!res.ok) return;
    const b: { unread: number; items: Item[] } = await res.json();
    // System notification for anything new since the last poll (not on first load).
    if (seen.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const n of b.items) if (!seen.current.has(n.id) && !n.readAt) new Notification(n.title, { body: n.body });
    }
    seen.current = new Set(b.items.map((n) => n.id));
    setItems(b.items);
    setUnread(b.unread);
  }, []);

  useEffect(() => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="relative">
      <button
        onClick={async () => {
          setOpen((o) => !o);
          if (!open && unread > 0) {
            await fetch("/api/notifications", { method: "POST" });
            setUnread(0);
          }
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-ink-2 hover:bg-surface hover:text-ink"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="money absolute right-0.5 top-0.5 min-w-5 rounded-full bg-madder px-1 text-center text-xs leading-5 text-paper">{unread}</span>
        )}
      </button>
      {open && (
        <div className="panel absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] p-2 shadow-[0_12px_40px_-12px_rgb(21_25_53/0.35)]">
          <p className="px-2 pb-1 pt-1 text-sm font-semibold">Notifications</p>
          {permission === "default" && (
            <button
              onClick={async () => setPermission(await Notification.requestPermission())}
              className="btn btn-secondary btn-sm mb-2 w-full"
            >
              Turn on alerts on this device
            </button>
          )}
          {items.length === 0 ? (
            <p className="px-2 pb-2 text-sm text-ink-3">Nothing yet. Updates about your deals and orders appear here.</p>
          ) : (
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.link ?? "#"}
                    onClick={() => setOpen(false)}
                    className={`block rounded-xl px-3 py-2 hover:bg-surface ${n.readAt ? "" : "bg-indigo-soft/60"}`}
                  >
                    <p className="font-semibold" lang={/[\u0900-\u097F]/.test(n.title) ? "hi" : undefined}>
                      {n.title}
                    </p>
                    <p className="text-sm text-ink-2">{n.body}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
