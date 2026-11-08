"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";

export default function ResetRequest() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent)
    return (
      <AuthShell title="Check your email">
        <div className="panel panel-raised p-6" role="status">
          <p className="text-ink-2">
            If <span className="font-semibold text-ink">{email}</span> has a Mandix account, a reset link is on its way. The
            link works for 30 minutes.
          </p>
          <Link href="/login" className="btn btn-secondary mt-6 w-full">
            Back to log in
          </Link>
        </div>
      </AuthShell>
    );

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with and we'll send you a link to choose a new password."
    >
      <form
        className="panel panel-raised space-y-5 p-6"
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
          <input
            id="reset-email"
            className="field"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="notice notice-bad text-sm">
            {error}
          </p>
        )}
        <button disabled={busy} className="btn btn-primary w-full">
          {busy ? "Sending…" : "Send reset link"}
        </button>
        <p className="text-center text-sm text-ink-3">
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-indigo hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
