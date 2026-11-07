"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LoginPanel } from "@/components/LoginPanel";

function Login() {
  const params = useSearchParams();
  const next = params.get("next");
  const needs = params.get("needs");
  return (
    <main className="page-narrow max-w-md">
      <h1 className="display text-4xl">Log in</h1>
      {needs === "buyer" || needs === "seller" ? (
        <p role="status" className="notice mt-4 mb-8">
          That page is for {needs === "seller" ? "sellers" : "buyers"}, and you&apos;re signed in with a {needs === "seller" ? "buyer" : "seller"} account. Log in
          as a {needs} to open it.
        </p>
      ) : (
        <p className="mt-2 mb-8 text-ink-2">Welcome back. Your deals and orders are where you left them.</p>
      )}
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
