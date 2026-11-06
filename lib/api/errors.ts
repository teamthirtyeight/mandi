import { NextResponse } from "next/server";
import { OrderError } from "@/lib/orders/service";
import { PaypalError } from "@/lib/paypal/rest";
import { AuthError } from "@/lib/auth/session";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function errorResponse(err: unknown) {
  if (err instanceof OrderError || err instanceof PaypalError || err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
