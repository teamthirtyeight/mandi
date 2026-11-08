"use client";

// Light, Dark or System theme. The choice is saved in this browser only and
// applied to <html data-theme>. System removes the attribute, so the operating
// system setting decides. THEME_SCRIPT runs before the page paints, so a saved
// choice never flashes the wrong theme.
import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "mandix-theme";
/** Fired on window whenever the applied theme may have changed. */
export const THEME_EVENT = "mandix-themechange";

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;

function readChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

const OPTIONS: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
      </>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />,
  },
  {
    value: "system",
    label: "System",
    icon: (
      <>
        <rect x="3" y="4.5" width="18" height="12" rx="2" />
        <path d="M8.5 20h7M12 16.5V20" />
      </>
    ),
  },
];

export function ThemeToggle({ showLabels = false }: { showLabels?: boolean }) {
  // Starts as null so server and client render the same markup.
  const [choice, setChoice] = useState<ThemeChoice | null>(null);
  useEffect(() => setChoice(readChoice()), []);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 ${showLabels ? "w-full" : ""}`}
    >
      {OPTIONS.map((o) => {
        const on = choice === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={showLabels ? undefined : `${o.label} theme`}
            title={showLabels ? undefined : o.label}
            onClick={() => {
              setChoice(o.value);
              apply(o.value);
            }}
            className={`flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors ${
              showLabels ? "h-9 flex-1" : "h-7 w-7"
            } ${on ? "bg-raised text-ink shadow-[var(--shadow-sm)]" : "text-ink-3 hover:text-ink"}`}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {o.icon}
            </svg>
            {showLabels && o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Calls `onChange` when the applied theme changes, by choice or by the OS. */
export function useThemeChange(onChange: () => void) {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", onChange);
    window.addEventListener(THEME_EVENT, onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener(THEME_EVENT, onChange);
    };
  }, [onChange]);
}
