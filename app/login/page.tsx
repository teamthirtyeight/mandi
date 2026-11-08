"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LoginPanel } from "@/components/LoginPanel";
import { AuthShell } from "@/components/AuthShell";

function Login() {
  const params = useSearchParams();
  const next = params.get("next");
  const needs = params.get("needs");
  return (
    <AuthShell title="Log in" subtitle="Welcome back. Your deals and orders are where you left them.">
      {(needs === "buyer" || needs === "seller") && (
        <p role="status" className="notice mb-6 text-sm">
          That page is for {needs === "seller" ? "sellers" : "buyers"}, and you&apos;re signed in with a {needs === "seller" ? "buyer" : "seller"} account. Log in
          as a {needs} to open it.
        </p>
      )}
      <LoginPanel next={next} />
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
