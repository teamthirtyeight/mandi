"use client";

// The "PayPal API calls" panel docked on every screen for signed-in users.
// Starts collapsed so it never covers the page; the choice is remembered on
// this device (open it before recording). Pages that show their own per-order
// log (order tracker, PayPal test page) and the phone view hide the dock.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { PayPalCallLog } from "./PayPalCallLog";

const KEY = "mandix-dock-open";

export function DockedCallLog({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(KEY) === "1");
    } catch {
      // storage unavailable: stay collapsed
    }
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  if (!signedIn || path.startsWith("/order/") || path.startsWith("/paypal-test") || path.startsWith("/seller")) return null;

  return open ? (
    <div className="panel fixed bottom-4 right-4 z-50 w-[min(400px,calc(100vw-2rem))] overflow-hidden shadow-[0_12px_40px_-12px_rgb(21_25_53/0.35)]">
      <div className="max-h-[45vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex justify-end bg-raised px-3 pt-2">
          <button onClick={() => toggle(false)} className="btn btn-quiet btn-sm">
            Hide
          </button>
        </div>
        <PayPalCallLog />
      </div>
    </div>
  ) : (
    <button
      onClick={() => toggle(true)}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-line bg-raised px-4 py-2 text-sm font-semibold text-ink-2 shadow-[0_8px_24px_-10px_rgb(21_25_53/0.35)] hover:text-ink"
    >
      <span className="h-2 w-2 rounded-full bg-leaf" aria-hidden="true" />
      PayPal API calls
    </button>
  );
}
