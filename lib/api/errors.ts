import { NextResponse } from "next/server";
import { OrderError } from "@/lib/orders/service";
import { PaypalError } from "@/lib/paypal/rest";
import { AuthError } from "@/lib/auth/session";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FRIENDLY: Record<string, string> = {
  INVALID_RESOURCE_ID: "PayPal doesn't recognise this payment, so nothing was changed. It may be demo data rather than a real sandbox payment.",
  AUTHORIZATION_EXPIRED: "The PayPal hold has expired. Void it and ask the buyer to approve again.",
  AUTHORIZATION_VOIDED: "This PayPal hold was already voided.",
  AUTHORIZATION_ALREADY_CAPTURED: "This payment was already captured.",
  REFUND_AMOUNT_EXCEEDED: "That's more than is left to refund on this payment.",
  CAPTURE_FULLY_REFUNDED: "This payment has already been fully refunded.",
  INSTRUMENT_DECLINED: "The buyer's payment method was declined.",
};

export function errorResponse(err: unknown) {
  if (err instanceof PaypalError) {
    // The raw path and code go to the server log; the user gets a plain sentence.
    console.error(err.message);
    const issue = err.message.split("failed: ")[1] ?? String(err.status);
    const plain = FRIENDLY[issue] ?? "PayPal couldn't complete this just now. Nothing was charged or refunded; try again in a minute.";
    return NextResponse.json({ error: `${plain} (PayPal: ${issue})` }, { status: err.status >= 500 ? 502 : err.status });
  }
  if (err instanceof OrderError || err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
