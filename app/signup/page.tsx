"use client";

// Sign-up. A seller account also creates the seller's profile: the story their
// agent tells buyers, the PayPal account they're paid into, their language,
// how fast they ship, and how much their agent may refund on its own.
// ?role=seller or ?role=buyer preselects the account type.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Role = "buyer" | "seller";

const ROLES: { value: Role; title: string; body: string }[] = [
  { value: "buyer", title: "I'm shopping", body: "Send an agent to haggle for you" },
  { value: "seller", title: "I'm selling", body: "List your work, let an agent sell it" },
];

function SignupForm() {
  const router = useRouter();
  const preset = useSearchParams().get("role");
  const [role, setRole] = useState<Role>(preset === "buyer" ? "buyer" : "seller");
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

  const passwordShort = f.password.length > 0 && f.password.length < 8;

  return (
    <main className="page-narrow">
      <h1 className="display text-4xl">Create an account</h1>
      <p className="mt-2 text-ink-2">Free to join. You only pay when you approve a deal in PayPal.</p>

      <fieldset className="mt-8">
        <legend className="label">Account type</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
          {ROLES.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={role === r.value}
              onClick={() => setRole(r.value)}
              className={`rounded-xl border px-4 py-3 text-left ${
                role === r.value ? "border-indigo bg-indigo-soft ring-1 ring-indigo" : "border-line-strong bg-raised hover:border-ink-3"
              }`}
            >
              <span className={`block font-semibold ${role === r.value ? "text-indigo" : ""}`}>{r.title}</span>
              <span className="block text-sm text-ink-2">{r.body}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <form onSubmit={submit} className="panel mt-6 space-y-6 p-6">
        <div className="space-y-5">
          <div>
            <label htmlFor="su-name" className="label">
              Your name
            </label>
            <input id="su-name" className="field" autoComplete="name" required value={f.name} onChange={set("name")} />
          </div>
          <div>
            <label htmlFor="su-email" className="label">
              Email
            </label>
            <input id="su-email" className="field" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />
          </div>
          <div>
            <label htmlFor="su-password" className="label">
              Password
            </label>
            <input
              id="su-password"
              className="field"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              aria-describedby="su-password-hint"
              aria-invalid={passwordShort}
              value={f.password}
              onChange={set("password")}
            />
            <p id="su-password-hint" className={`mt-1.5 text-sm ${passwordShort ? "text-madder" : "text-ink-3"}`}>
              At least 8 characters.
            </p>
          </div>
        </div>

        {role === "buyer" ? (
          <div>
            <label htmlFor="su-ship" className="label">
              Country you ship to
            </label>
            <input id="su-ship" className="field max-w-[8rem] uppercase" maxLength={2} value={f.shipToCountry} onChange={set("shipToCountry")} aria-describedby="su-ship-hint" />
            <p id="su-ship-hint" className="hint mt-1.5">
              Two-letter code, like GB or US. Your agent only buys what can arrive there in time.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-5 border-t border-line pt-6">
              <div>
                <h2 className="title text-xl">Your shop</h2>
                <p className="hint mt-1">Your agent uses this to tell buyers about you and to defend your price.</p>
              </div>
              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <div>
                  <label htmlFor="su-city" className="label">
                    City
                  </label>
                  <input id="su-city" className="field" value={f.city} onChange={set("city")} />
                </div>
                <div>
                  <label htmlFor="su-country" className="label">
                    Country
                  </label>
                  <input id="su-country" className="field uppercase" maxLength={2} value={f.country} onChange={set("country")} />
                </div>
              </div>
              <div>
                <label htmlFor="su-story" className="label">
                  Your story
                </label>
                <textarea
                  id="su-story"
                  className="field"
                  rows={3}
                  placeholder="Your craft, who taught you, how long a piece takes."
                  value={f.story}
                  onChange={set("story")}
                />
              </div>
              <div>
                <label htmlFor="su-language" className="label">
                  Language for alerts
                </label>
                <select id="su-language" className="field" value={f.language} onChange={set("language")}>
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <div className="space-y-5 border-t border-line pt-6">
              <div>
                <h2 className="title text-xl">Getting paid</h2>
              </div>
              <div>
                <label htmlFor="su-paypal" className="label">
                  PayPal email
                </label>
                <input id="su-paypal" className="field" type="email" value={f.paypalEmail} onChange={set("paypalEmail")} aria-describedby="su-paypal-hint" />
                <p id="su-paypal-hint" className="hint mt-1.5">
                  In this demo, buyers pay Mandi&apos;s PayPal merchant account and sellers are paid out from it. Paying you
                  directly is switched on once your account is verified.
                </p>
              </div>
              <div>
                <label htmlFor="su-refund" className="label">
                  Your agent may refund up to
                </label>
                <div className="flex max-w-[10rem] items-center gap-2">
                  <span className="text-ink-2">£</span>
                  <input id="su-refund" className="field money" type="number" min={0} value={f.refundCap} onChange={set("refundCap")} aria-describedby="su-refund-hint" />
                </div>
                <p id="su-refund-hint" className="hint mt-1.5">
                  For small problems, your agent refunds the buyer without asking you. Anything larger waits for your tap.
                </p>
              </div>
            </div>

            <div className="space-y-5 border-t border-line pt-6">
              <h2 className="title text-xl">Shipping</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="su-shipby" className="label">
                    Ship within
                  </label>
                  <div className="flex items-center gap-2">
                    <input id="su-shipby" className="field money" type="number" min={1} max={3} value={f.shipByDays} onChange={set("shipByDays")} />
                    <span className="text-ink-2">days</span>
                  </div>
                  <p className="hint mt-1.5">Up to 3, while PayPal holds the money.</p>
                </div>
                <div>
                  <label htmlFor="su-transit" className="label">
                    Delivery takes
                  </label>
                  <div className="flex items-center gap-2">
                    <input id="su-transit" className="field money" type="number" min={1} max={30} value={f.transitDays} onChange={set("transitDays")} />
                    <span className="text-ink-2">days</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="notice notice-bad text-sm">
            {error}
          </p>
        )}
        <button disabled={busy} className="btn btn-primary btn-lg w-full">
          {busy ? "Creating your account…" : role === "seller" ? "Create seller account" : "Create account"}
        </button>
        <p className="text-center text-sm text-ink-2">
          Already have an account?{" "}
          <Link href="/login" className="link">
            Log in
          </Link>
        </p>
      </form>
    </main>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
