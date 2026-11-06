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
    <div className="rounded-lg border border-neutral-200 bg-white p-3 text-sm">
      <p className="mb-2 text-neutral-600">PayPal sandbox buyer login (test money only)</p>
      {[
        ["Email", email],
        ["Password", password],
      ].map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-2">
          <span className="text-neutral-500">{label}</span>
          <code className="truncate">{value}</code>
          <button onClick={() => copy(label, value)} className="text-xs underline">
            {copied === label ? "Copied" : "Copy"}
          </button>
        </div>
      ))}
    </div>
  );
}
