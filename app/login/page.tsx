"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const DEMOS = [
  { as: "sarah", label: "Sarah · buyer, London" },
  { as: "meera", label: "Meera · seller, Varanasi" },
  { as: "arjun", label: "Arjun · seller, Jaipur" },
  { as: "fatima", label: "Fatima · seller, Srinagar" },
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
    <main className="mx-auto max-w-md space-y-8 p-8">
      <h1 className="text-3xl font-semibold">Log in</h1>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          go("/api/auth/login", { email, password });
        }}
      >
        <input className="w-full rounded-lg border border-neutral-300 px-3 py-2" type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded-lg border border-neutral-300 px-3 py-2" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} className="w-full rounded-lg bg-neutral-900 px-5 py-3 text-white disabled:opacity-40">
          Log in
        </button>
        <p className="text-sm text-neutral-600">
          New here? <Link href="/signup" className="underline">Create an account</Link>
        </p>
      </form>

      <section className="space-y-2 rounded-xl border border-neutral-200 p-4">
        <p className="font-medium">Judges: one-click demo accounts</p>
        <div className="grid gap-2">
          {DEMOS.map((d) => (
            <button key={d.as} disabled={busy} onClick={() => go("/api/auth/demo", { as: d.as })} className="rounded-lg border border-neutral-300 px-4 py-2 text-left hover:bg-neutral-50 disabled:opacity-40">
              {d.label}
            </button>
          ))}
        </div>
      </section>
      {error && <p className="text-red-700">{error}</p>}
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
