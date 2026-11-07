"use client";

// Sandbox buyer login for judges, shown next to the PayPal button.
// Values come from NEXT_PUBLIC_DEMO_BUYER_* (a PayPal sandbox personal account, test money only).
import { useState } from "react";

export function DemoLogin() {
  const email = process.env.NEXT_PUBLIC_DEMO_BUYER_EMAIL;
  const password = process.env.NEXT_PUBLIC_DEMO_BUYER_PASSWORD;
  const [copied, setCopied] = useState<string | null>(null);
  if (!email || !password) return null;

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-raised p-3 text-sm">
      <p className="mb-2 font-semibold">PayPal sandbox buyer login</p>
      <p className="hint mb-2">Test money only. Use it in the PayPal window.</p>
      <dl className="space-y-1">
        {[
          ["Email", email],
          ["Password", password],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center gap-3">
            <dt className="w-16 shrink-0 text-ink-3">{label}</dt>
            <dd className="min-w-0 flex-1 truncate font-medium">{value}</dd>
            <button onClick={() => copy(label, value)} className="btn btn-quiet btn-sm" aria-label={`Copy ${label.toLowerCase()}`}>
              <span aria-live="polite">{copied === label ? "Copied" : "Copy"}</span>
            </button>
          </div>
        ))}
      </dl>
    </div>
  );
}
