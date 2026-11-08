"use client";

// "Connect PayPal" for sellers: PayPal's own sign-up opens in a PayPal window
// over Mandi, where the seller logs in or creates a business account. When it
// closes, PayPal sends them back and Mandi saves the account it confirmed with
// PayPal (app/api/seller/paypal/return). The email field stays as a fallback.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Connection {
  available: boolean;
  status: "connected" | "needs_attention" | null;
  merchantId: string | null;
  email: string | null;
}

declare global {
  interface Window {
    PAYPAL?: { apps?: { Signup?: { render?: () => void; MiniBrowser?: { init?: () => void } } } };
  }
}

const RESULT: Record<string, { text: string; tone: "" | "notice-bad" }> = {
  connected: { text: "PayPal is connected. Your payouts go to this account.", tone: "" },
  needs_attention: { text: "PayPal account linked. Confirm your email in PayPal so it can receive money, then check again.", tone: "" },
  pending: { text: "PayPal hasn't confirmed your sign-up yet. If you finished it, check again in a minute.", tone: "" },
  declined: { text: "You didn't give Mandix permission in PayPal, so nothing was connected.", tone: "notice-bad" },
  mismatch: { text: "That PayPal sign-up belongs to a different Mandix account, so it wasn't connected.", tone: "notice-bad" },
  error: { text: "PayPal couldn't confirm the account just now. Try again in a minute.", tone: "notice-bad" },
};

function loadPartnerScript(src: string) {
  const ready = () => window.PAYPAL?.apps?.Signup?.render?.();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing) return ready();
  const s = document.createElement("script");
  s.src = src;
  s.id = "paypal-js";
  s.async = true;
  s.onload = ready;
  document.body.appendChild(s);
}

export function ConnectPayPal() {
  const params = useSearchParams();
  const result = params.get("paypal");
  const [conn, setConn] = useState<Connection | null>(null);
  const [link, setLink] = useState<{ actionUrl: string; scriptUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const anchor = useRef<HTMLAnchorElement>(null);

  const load = (refresh = false) =>
    fetch(`/api/seller/paypal/connect${refresh ? "?refresh=1" : ""}`)
      .then((r) => r.json())
      .then((c: Connection) => setConn(c))
      .catch(() => setError("Couldn't load your PayPal connection."));

  useEffect(() => {
    load(result === "needs_attention" || result === "pending");
  }, [result]);

  // Not connected yet: get a sign-up link from PayPal and arm the button.
  useEffect(() => {
    if (!conn?.available || conn.status === "connected" || link) return;
    fetch("/api/seller/paypal/connect", { method: "POST" })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        setLink(b);
      })
      .catch((e: Error) => setError(e.message || "PayPal couldn't start sign-up. Try again in a minute."));
  }, [conn, link]);

  useEffect(() => {
    if (link && anchor.current) loadPartnerScript(link.scriptUrl);
  }, [link]);

  const [checked, setChecked] = useState(false);
  async function checkAgain() {
    setChecking(true);
    await load(true);
    setChecking(false);
    setChecked(true);
  }

  if (!conn) return null;
  if (!conn.available) return null; // No platform app configured: the email field below is the way.

  const notice = result ? RESULT[result] : null;
  return (
    <div className="space-y-3">
      {notice && <p className={`notice text-sm ${notice.tone}`}>{notice.text}</p>}
      {conn.status === "connected" ? (
        <p className="flex flex-wrap items-center gap-2">
          <span className="chip chip-safe">Connected to PayPal</span>
          <span className="text-sm text-ink-2">{conn.email ?? (conn.merchantId ? `PayPal account ${conn.merchantId}` : "")}</span>
        </p>
      ) : (
        <div className="well space-y-3 p-4">
          <p className="font-semibold">Connect your PayPal account</p>
          <p className="text-sm text-ink-2">
            Log in to PayPal, or create a free PayPal business account if you don&apos;t have one. It opens in a PayPal window here, and you come straight back.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {link ? (
              <a
                ref={anchor}
                className="btn btn-primary"
                data-paypal-button="true"
                href={link.actionUrl}
                target="PPFrame"
                onClick={() => setError(null)}
              >
                Connect PayPal
              </a>
            ) : (
              <button className="btn btn-primary" disabled>
                Getting PayPal ready…
              </button>
            )}
            {/* PayPal doesn't send sellers back when sign-up stops early (e.g. ID checks postponed). */}
            <button type="button" className="btn btn-secondary" onClick={checkAgain} disabled={checking}>
              {checking ? "Checking with PayPal…" : conn.status === "needs_attention" ? "Check again" : "Finished in PayPal? Check now"}
            </button>
          </div>
          {conn.status === "needs_attention" && (
            <p className="hint">
              Linked{conn.merchantId ? ` (PayPal account ${conn.merchantId})` : ""}, but PayPal hasn&apos;t finished setting it up: usually the email isn&apos;t
              confirmed or ID checks are still to do. Mandix can already send your payouts there; PayPal releases them once it&apos;s done.
            </p>
          )}
          {checked && !conn.status && <p className="notice text-sm">PayPal hasn&apos;t linked an account to you yet. Finish sign-up in the PayPal window first.</p>}
          {error && <p className="notice notice-bad text-sm">{error}</p>}
        </div>
      )}
    </div>
  );
}
