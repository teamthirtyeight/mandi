"use client";

import { useState } from "react";
import Link from "next/link";

export default function ResetRequest() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="page-narrow max-w-md">
      <h1 className="display text-4xl">Reset your password</h1>
      {sent ? (
        <div className="panel mt-8 p-6" role="status">
          <p className="title text-xl">Check your email</p>
          <p className="mt-2 text-ink-2">
            If <span className="font-semibold text-ink">{email}</span> has a Mandi account, a reset link is on its way. The
            link works for 30 minutes.
          </p>
          <Link href="/login" className="btn btn-secondary mt-6">
            Back to log in
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-2 text-ink-2">Enter the email you signed up with and we&apos;ll send you a link to choose a new password.</p>
          <form
            className="panel mt-8 space-y-5 p-6"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              const res = await fetch("/api/auth/reset/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
              setBusy(false);
              if (res.ok) setSent(true);
              else setError((await res.json()).error);
            }}
          >
            <div>
              <label htmlFor="reset-email" className="label">
                Email
              </label>
              <input id="reset-email" className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && (
              <p role="alert" className="notice notice-bad text-sm">
                {error}
              </p>
            )}
            <button disabled={busy} className="btn btn-primary btn-lg w-full">
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <p className="text-center text-sm text-ink-2">
              Remembered it?{" "}
              <Link href="/login" className="link">
                Log in
              </Link>
            </p>
          </form>
        </>
      )}
    </main>
  );
}
