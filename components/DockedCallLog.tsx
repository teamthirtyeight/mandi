"use client";

// The "PayPal API calls" panel docked on every screen. Pages that show their
// own per-order log (order tracker, PayPal test page) hide the dock.
import { useState } from "react";
import { usePathname } from "next/navigation";
import { PayPalCallLog } from "./PayPalCallLog";

export function DockedCallLog() {
  const path = usePathname();
  const [open, setOpen] = useState(true);
  if (path.startsWith("/order/") || path.startsWith("/paypal-test")) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(400px,calc(100vw-2rem))] shadow-lg">
      {open ? (
        <div className="max-h-[40vh] overflow-y-auto rounded-xl bg-white">
          <div className="sticky top-0 flex justify-end bg-white px-3 pt-2">
            <button onClick={() => setOpen(false)} className="text-xs text-neutral-500 underline">
              Hide
            </button>
          </div>
          <PayPalCallLog />
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2 text-left text-sm font-medium">
          PayPal API calls ▴
        </button>
      )}
    </div>
  );
}
