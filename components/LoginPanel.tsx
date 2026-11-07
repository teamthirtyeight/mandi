"use client";

// Email/password login plus the judges' one-click demo accounts. Used on the
// login page and on the right of the home page.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const DEMOS = [
  { as: "sarah", label: "Sarah · buyer, London", note: "Shops for a scarf for her mum" },
  { as: "meera", label: "Meera · seller, Varanasi", note: "Banarasi silk weaver, reads alerts in Hindi" },
  { as: "arjun", label: "Arjun · seller, Jaipur", note: "Indigo block printer" },
  { as: "fatima", label: "Fatima · seller, Srinagar", note: "Sozni embroiderer" },
] as const;

const home = (role: string) => (role === "seller" ? "/dashboard" : "/shop");

export function LoginPanel({ next, compact = false }: { next?: string | null; compact?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Couldn't log in");
    router.push(next && next.startsWith("/") ? next : home(json.user.role));
    router.refresh();
  }

  return (
    <div className={compact ? "space-y-4" : "space-y-8"}>
      <form
        className={`panel space-y-4 ${compact ? "p-5" : "p-6"}`}
        onSubmit={(e) => {
          e.preventDefault();
          go("/api/auth/login", { email, password });
        }}
      >
        {compact && <h2 className="title text-xl">Log in</h2>}
        <div>
          <label htmlFor="login-email" className="label">
            Email
          </label>
          <input id="login-email" className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="login-password" className="label">
              Password
            </label>
            <Link href="/reset" className="link text-sm">
              Forgot password?
            </Link>
          </div>
          <input
            id="login-password"
            className="field"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="notice notice-bad text-sm">
            {error}
          </p>
        )}
        <button disabled={busy} className="btn btn-primary btn-lg w-full">
          {busy ? "Logging in…" : "Log in"}
        </button>
        <p className="text-center text-sm text-ink-2">
          New to Mandi?{" "}
          <Link href="/signup?role=buyer" className="link">
            Shop
          </Link>{" "}
          or{" "}
          <Link href="/signup?role=seller" className="link">
            sell
          </Link>
        </p>
      </form>

      <section className="rounded-[1.25rem] border border-dashed border-line-strong bg-surface p-4" aria-labelledby="demo-heading">
        <h2 id="demo-heading" className="font-semibold">
          Judging? Use a demo account
        </h2>
        <p className="hint mt-0.5">One click logs you in. No password needed.</p>
        <div className={`mt-3 grid gap-2 ${compact ? "sm:grid-cols-2" : ""}`}>
          {DEMOS.map((d) => (
            <button
              key={d.as}
              disabled={busy}
              onClick={() => go("/api/auth/demo", { as: d.as })}
              className="flex w-full flex-col items-start rounded-xl border border-line bg-raised px-3.5 py-2 text-left hover:border-indigo disabled:opacity-45"
            >
              <span className="text-[0.9375rem] font-semibold">{d.label}</span>
              <span className="text-xs text-ink-3">{d.note}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
