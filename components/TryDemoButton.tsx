"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TryDemoButton({ hostile = false, label = "Try the demo" }: { hostile?: boolean; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/demo/start${hostile ? "?hostile=2" : ""}`, { method: "POST" });
          const body = await res.json();
          if (!res.ok) {
            setBusy(false);
            return setError(body.error);
          }
          router.push(`/deal/${body.mandateId}`);
          router.refresh(); // the nav picks up the demo sign-in
        }}
        className={hostile ? "btn btn-secondary" : "btn btn-primary btn-lg"}
      >
        {busy ? "Starting the agents…" : label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-madder">
          {error}
        </p>
      )}
    </div>
  );
}
