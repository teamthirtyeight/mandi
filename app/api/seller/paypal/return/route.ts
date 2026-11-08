// Where PayPal sends the seller after sign-up. The query string is only a
// hint: connectSellerPaypal checks the merchant with PayPal before saving.
import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth/session";
import { appUrl } from "@/lib/notify";
import { connectSellerPaypal } from "@/lib/sellers/paypal-connect";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const back = (result: string) => NextResponse.redirect(`${appUrl()}/agent?paypal=${result}#getting-paid`);
  try {
    const user = await requireUser("seller");
    const params = new URL(req.url).searchParams;
    const merchantId = params.get("merchantIdInPayPal");
    if (params.get("permissionsGranted") === "false") return back("declined");
    const outcome = await connectSellerPaypal(user.sellerId!, merchantId);
    if (!outcome.ok) return back(outcome.reason === "other_seller" ? "mismatch" : "pending");
    return back(outcome.status.paymentsReceivable && outcome.status.emailConfirmed ? "connected" : "needs_attention");
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.redirect(`${appUrl()}/login?next=/agent`);
    console.error("[paypal connect] return failed", err);
    return back("error");
  }
}
