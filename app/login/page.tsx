"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LoginPanel } from "@/components/LoginPanel";

function Login() {
  const next = useSearchParams().get("next");
  return (
    <main className="page-narrow max-w-md">
      <h1 className="display text-4xl">Log in</h1>
      <p className="mt-2 mb-8 text-ink-2">Welcome back. Your deals and orders are where you left them.</p>
      <LoginPanel next={next} />
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
