// One negotiation as a chat between two agents: seller on the left, buyer on
// the right, each offer's price set beside its bubble, engine blocks inline,
// and the outcome at the foot. Used by the negotiation room, the seller's
// dashboard transcript and the home page replay, so a deal reads the same
// everywhere.
//
// With `scroll`, the messages sit in their own scrolling window that follows
// new messages as they stream in, unless the reader has scrolled up to read,
// in which case a "New messages" button appears instead of yanking them down.
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ChatSide = "seller" | "buyer";

export interface ChatLine {
  id: string;
  from: ChatSide | "engine";
  text: string;
  price: number | null;
  /** Engine blocked this move (shown as a red line, not a bubble). */
  blocked?: boolean;
  /** Small notes under a bubble: "Injection attempt ignored", "rule-based", … */
  notes?: string[];
}

export type ChatOutcome =
  | { kind: "agreed"; price: number; held?: string | null }
  | { kind: "walked"; text: string }
  | { kind: "blocked"; text: string }
  | null;

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);

export function NegotiationChat({
  lines,
  currency = "GBP",
  left,
  right,
  outcome = null,
  typing = false,
  stagger = false,
  scroll = false,
  className = "",
}: {
  lines: ChatLine[];
  currency?: string;
  /** Legend for each side, e.g. "Meera's agent" / "Your agent". */
  left: string;
  right: string;
  outcome?: ChatOutcome;
  /** An agent is composing: dots appear on the side whose turn it is. */
  typing?: boolean;
  /** Reveal lines one after another (the home page replay). */
  stagger?: boolean;
  /** Keep the messages in a fixed-height window that scrolls. */
  scroll?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true); // reader is at (or near) the newest message
  const [unseen, setUnseen] = useState(false);
  const count = lines.length + (typing ? 1 : 0);

  const toBottom = (smooth: boolean) => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  // Open at the newest message.
  useLayoutEffect(() => {
    if (scroll) toBottom(false);
  }, [scroll]);

  // Follow new messages, unless the reader has scrolled up.
  useEffect(() => {
    if (!scroll) return;
    if (following.current) toBottom(true);
    else setUnseen(true);
  }, [count, scroll]);

  const talk = lines.filter((l) => l.from !== "engine");
  const nextSide: ChatSide = talk.length && talk[talk.length - 1].from === "seller" ? "buyer" : "seller";
  const delay = (i: number) => (stagger ? { animationDelay: `${250 + i * 420}ms` } : undefined);

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between gap-3 text-xs font-semibold text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-line-strong" aria-hidden="true" />
          {left}
        </span>
        <span className="flex items-center gap-1.5">
          {right}
          <span className="h-2 w-2 rounded-full bg-indigo" aria-hidden="true" />
        </span>
      </div>

      <div className="relative">
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
          if (following.current) setUnseen(false);
        }}
        className={scroll ? "max-h-[26rem] overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]" : ""}
        tabIndex={scroll ? 0 : undefined}
        aria-label={scroll ? "Messages" : undefined}
      >
      <ol className="space-y-2.5" aria-live="polite">
        {lines.map((l, i) =>
          l.from === "engine" ? (
            <li key={l.id} className="chat-line" style={delay(i)}>
              {l.blocked ? (
                <p className="flex items-start gap-2 rounded-xl bg-madder-soft px-3 py-2 text-sm text-madder">
                  <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M5.6 5.6l12.8 12.8" />
                  </svg>
                  <span>
                    <b>Engine blocked.</b> <span className="text-ink">{l.text}</span>
                  </span>
                </p>
              ) : (
                <p className="text-center text-sm text-ink-3">{l.text}</p>
              )}
            </li>
          ) : (
            <li key={l.id} className={`chat-line flex items-end gap-3 ${l.from === "buyer" ? "flex-row-reverse" : ""}`} style={delay(i)}>
              <div
                className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[0.9375rem] leading-snug ${
                  l.from === "seller" ? "rounded-bl-md bg-surface" : "rounded-br-md bg-indigo-soft"
                }`}
              >
                <p>{l.text}</p>
                {l.notes && l.notes.length > 0 && (
                  <p className={`mt-1 text-xs ${l.notes.some((n) => /inject|withheld/i.test(n)) ? "font-semibold text-madder" : "text-ink-3"}`}>
                    {l.notes.join(", ")}
                  </p>
                )}
              </div>
              {l.price != null && (
                <span className={`money shrink-0 pb-1.5 text-lg ${l.from === "buyer" ? "text-indigo" : ""}`}>{money(l.price, currency)}</span>
              )}
            </li>
          ),
        )}

        {typing && (
          <li className={`chat-line flex ${nextSide === "buyer" ? "justify-end" : ""}`} aria-label="An agent is typing">
            <span className={`flex items-center gap-1 rounded-2xl px-3.5 py-3 ${nextSide === "seller" ? "rounded-bl-md bg-surface" : "rounded-br-md bg-indigo-soft"}`}>
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-3 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-3 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-3" />
            </span>
          </li>
        )}
      </ol>
      </div>
      {scroll && unseen && (
        <button
          type="button"
          onClick={() => {
            following.current = true;
            setUnseen(false);
            toBottom(true);
          }}
          className="chip chip-progress absolute bottom-2 left-1/2 -translate-x-1/2 shadow-[0_6px_16px_-6px_rgb(21_25_53/0.4)]"
        >
          New messages
        </button>
      )}
      </div>

      {outcome && (
        <div className="chat-line mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4" style={delay(lines.length)}>
          {outcome.kind === "agreed" ? (
            <>
              <span className="display rounded-xl bg-haldi px-3 py-1.5 text-xl text-ink">Agreed at {money(outcome.price, currency)}</span>
              {outcome.held && <span className="chip chip-safe">{outcome.held}</span>}
            </>
          ) : (
            <span className={`chip ${outcome.kind === "blocked" ? "chip-bad" : ""}`}>{outcome.text}</span>
          )}
        </div>
      )}
    </div>
  );
}
