"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function ResetConfirm({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = password.length > 0 && password.length < 8;
  return (
    <main className="page-narrow max-w-md">
      <h1 className="display text-4xl">Choose a new password</h1>
      <p className="mt-2 text-ink-2">You&apos;ll be logged in as soon as it&apos;s set.</p>
      <form
        className="panel mt-8 space-y-5 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await fetch("/api/auth/reset/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
          if (!res.ok) {
            setBusy(false);
            return setError((await res.json()).error);
          }
          router.push("/");
          router.refresh();
        }}
      >
        <div>
          <label htmlFor="new-password" className="label">
            New password
          </label>
          <input
            id="new-password"
            className="field"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            aria-describedby="new-password-hint"
            aria-invalid={short}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p id="new-password-hint" className={`mt-1.5 text-sm ${short ? "text-madder" : "text-ink-3"}`}>
            At least 8 characters.
          </p>
        </div>
        {error && (
          <div role="alert" className="notice notice-bad text-sm">
            <p>{error}</p>
            <Link href="/reset" className="mt-1 inline-block font-semibold underline">
              Request a new link
            </Link>
          </div>
        )}
        <button disabled={busy} className="btn btn-primary btn-lg w-full">
          {busy ? "Saving…" : "Set password and log in"}
        </button>
      </form>
    </main>
  );
}
