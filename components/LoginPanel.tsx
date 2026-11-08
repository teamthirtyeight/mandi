"use client";

// Email/password login plus the judges' one-click demo accounts. Used on the
// login page and on the right of the home page.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { safeNext } from "@/lib/auth/routes";

const DEMOS = [
  { as: "sarah", name: "Sarah", role: "Buyer", place: "London", note: "Shopping for a scarf for her mum" },
  { as: "meera", name: "Meera", role: "Seller", place: "Varanasi", note: "Banarasi silk weaver" },
  { as: "arjun", name: "Arjun", role: "Seller", place: "Jaipur", note: "Indigo block printer" },
  { as: "fatima", name: "Fatima", role: "Seller", place: "Srinagar", note: "Sozni embroiderer" },
] as const;

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
    router.push(safeNext(next, json.user.role));
    router.refresh();
  }

  return (
    <div className="panel panel-raised overflow-hidden">
      <form
        className={`space-y-4 ${compact ? "p-6" : "p-7"}`}
        onSubmit={(e) => {
          e.preventDefault();
          go("/api/auth/login", { email, password });
        }}
      >
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Log in to Mandi</h2>
          <p className="mt-0.5 text-sm text-ink-3">Welcome back. Enter your details to continue.</p>
        </div>
        <div>
          <label htmlFor="login-email" className="label">
            Email
          </label>
          <input
            id="login-email"
            className="field"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="login-password" className="label">
              Password
            </label>
            <Link href="/reset" className="text-xs font-medium text-indigo hover:underline">
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
        <button disabled={busy} className="btn btn-primary w-full">
          {busy ? "Logging in…" : "Log in"}
        </button>
        <p className="text-center text-sm text-ink-3">
          New to Mandi?{" "}
          <Link href="/signup?role=buyer" className="font-medium text-indigo hover:underline">
            Shop
          </Link>{" "}
          or{" "}
          <Link href="/signup?role=seller" className="font-medium text-indigo hover:underline">
            sell
          </Link>
        </p>
      </form>

      <section className="border-t border-line bg-surface px-6 py-5" aria-labelledby="demo-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="demo-heading" className="text-sm font-semibold">
            Demo accounts
          </h2>
          <span className="text-xs text-ink-3">One click, no password</span>
        </div>
        <div className={`mt-3 grid gap-2 ${compact ? "sm:grid-cols-2 lg:grid-cols-1" : "sm:grid-cols-2"}`}>
          {DEMOS.map((d) => (
            <button
              key={d.as}
              disabled={busy}
              onClick={() => go("/api/auth/demo", { as: d.as })}
              className="group flex w-full items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2.5 text-left shadow-[var(--shadow-xs)] transition-colors hover:border-indigo disabled:opacity-45"
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  d.role === "Buyer" ? "bg-indigo-soft text-indigo" : "bg-haldi-soft text-haldi-ink"
                }`}
                aria-hidden="true"
              >
                {d.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {d.name}
                  <span className="font-normal text-ink-3">
                    {d.role}, {d.place}
                  </span>
                </span>
                <span className="block truncate text-xs text-ink-3">{d.note}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
