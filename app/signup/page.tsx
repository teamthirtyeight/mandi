"use client";

// Sign-up. A seller account also creates the seller's profile: the story their
// agent tells buyers, the PayPal account they're paid into, their language,
// how fast they ship, and how much their agent may refund on its own.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [role, setRole] = useState<"buyer" | "seller">("seller");
  const [f, setF] = useState({
    name: "",
    email: "",
    password: "",
    shipToCountry: "GB",
    city: "",
    country: "IN",
    story: "",
    paypalEmail: "",
    language: "hi",
    shipByDays: 3,
    transitDays: 7,
    refundCap: 10,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((v) => ({ ...v, [k]: typeof v[k] === "number" ? Number(e.target.value) : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body =
      role === "buyer"
        ? { role, name: f.name, email: f.email, password: f.password, shipToCountry: f.shipToCountry }
        : { role, ...f };
    const res = await fetch("/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Couldn't create the account");
    router.push(role === "seller" ? "/sell" : "/shop");
    router.refresh();
  }

  const input = "w-full rounded-lg border border-neutral-300 px-3 py-2";
  return (
    <main className="mx-auto max-w-lg space-y-6 p-8">
      <h1 className="text-3xl font-semibold">Create an account</h1>
      <div className="flex gap-2">
        {(["seller", "buyer"] as const).map((r) => (
          <button key={r} onClick={() => setRole(r)} className={`rounded-lg px-4 py-2 ${role === r ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}>
            {r === "seller" ? "I'm selling" : "I'm shopping"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input className={input} placeholder="Your name" value={f.name} onChange={set("name")} />
        <input className={input} type="email" placeholder="Email" autoComplete="email" value={f.email} onChange={set("email")} />
        <input className={input} type="password" placeholder="Password (8+ characters)" autoComplete="new-password" value={f.password} onChange={set("password")} />

        {role === "buyer" ? (
          <label className="block text-sm text-neutral-600">
            Ship to (country code)
            <input className={input} maxLength={2} value={f.shipToCountry} onChange={set("shipToCountry")} />
          </label>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <input className={input} placeholder="City" value={f.city} onChange={set("city")} />
              <input className={input} placeholder="Country code" maxLength={2} value={f.country} onChange={set("country")} />
            </div>
            <textarea
              className={input}
              rows={3}
              placeholder="Your story: your craft, how long a piece takes. Your agent uses this to defend your price."
              value={f.story}
              onChange={set("story")}
            />
            <input className={input} type="email" placeholder="PayPal email you're paid into" value={f.paypalEmail} onChange={set("paypalEmail")} />
            <div className="grid grid-cols-2 gap-3 text-sm text-neutral-600">
              <label>
                Language
                <select className={input} value={f.language} onChange={set("language")}>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label>
                Ship within (days, max 3)
                <input className={input} type="number" min={1} max={3} value={f.shipByDays} onChange={set("shipByDays")} />
              </label>
              <label>
                Delivery time (days)
                <input className={input} type="number" min={1} max={30} value={f.transitDays} onChange={set("transitDays")} />
              </label>
              <label>
                Agent may refund up to (£)
                <input className={input} type="number" min={0} value={f.refundCap} onChange={set("refundCap")} />
              </label>
            </div>
          </>
        )}

        <button disabled={busy} className="w-full rounded-lg bg-neutral-900 px-5 py-3 text-white disabled:opacity-40">
          {busy ? "Creating…" : "Create account"}
        </button>
        <p className="text-sm text-neutral-600">
          Have an account? <Link href="/login" className="underline">Log in</Link>
        </p>
      </form>
      {error && <p className="text-red-700">{error}</p>}
    </main>
  );
}
