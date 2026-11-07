"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const DEMOS = [
  { as: "sarah", label: "Sarah · buyer, London", note: "Shops for a scarf for her mum" },
  { as: "meera", label: "Meera · seller, Varanasi", note: "Banarasi silk weaver, reads alerts in Hindi" },
  { as: "arjun", label: "Arjun · seller, Jaipur", note: "Indigo block printer" },
  { as: "fatima", label: "Fatima · seller, Srinagar", note: "Sozni embroiderer" },
] as const;

function home(role: string) {
  return role === "seller" ? "/dashboard" : "/shop";
}

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Couldn't log in");
    router.push(next && next.startsWith("/") ? next : home(json.user.role));
    router.refresh();
  }

  return (
    <main className="page-narrow max-w-md">
      <h1 className="display text-4xl">Log in</h1>
      <p className="mt-2 text-ink-2">Welcome back. Your deals and orders are where you left them.</p>

      <form
        className="panel mt-8 space-y-5 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          go("/api/auth/login", { email, password });
        }}
      >
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
          <Link href="/signup" className="link">
            Create an account
          </Link>
        </p>
      </form>

      <section className="mt-8 rounded-[1.25rem] border border-dashed border-line-strong bg-surface p-5" aria-labelledby="demo-heading">
        <h2 id="demo-heading" className="title text-lg">
          Judging? Use a demo account
        </h2>
        <p className="hint mt-1">One click logs you in. No password needed.</p>
        <div className="mt-4 grid gap-2">
          {DEMOS.map((d) => (
            <button
              key={d.as}
              disabled={busy}
              onClick={() => go("/api/auth/demo", { as: d.as })}
              className="flex w-full flex-col items-start rounded-xl border border-line bg-raised px-4 py-2.5 text-left hover:border-indigo disabled:opacity-45"
            >
              <span className="font-semibold">{d.label}</span>
              <span className="text-sm text-ink-3">{d.note}</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
