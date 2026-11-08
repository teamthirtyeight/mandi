// POST: a PayPal sign-up link for the signed-in seller (opens over Mandi).
// GET:  the seller's PayPal connection, re-checked with PayPal when asked.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";
import { appUrl } from "@/lib/notify";
import { PARTNER_JS_URL, partnerConfigured, sellerSignupLink } from "@/lib/paypal/partner";
import { connectSellerPaypal } from "@/lib/sellers/paypal-connect";

export const dynamic = "force-dynamic";

async function sellerRow(sellerId: string) {
  const [s] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, sellerId));
  return s;
}

const view = (s: typeof schema.sellers.$inferSelect) => ({
  available: partnerConfigured(),
  status: s.paypalConnectStatus,
  merchantId: s.paypalMerchantId,
  email: s.paypalMerchantEmail.includes("@") ? s.paypalMerchantEmail : null,
});

export async function GET(req: Request) {
  try {
    const user = await requireUser("seller");
    let s = await sellerRow(user.sellerId!);
    // ?refresh=1: ask PayPal again (e.g. after confirming the email).
    if (new URL(req.url).searchParams.get("refresh") && partnerConfigured() && s.paypalConnectStatus !== "connected") {
      await connectSellerPaypal(s.id, s.paypalMerchantId);
      s = await sellerRow(s.id);
    }
    return NextResponse.json(view(s));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST() {
  try {
    const user = await requireUser("seller");
    const s = await sellerRow(user.sellerId!);
    if (!partnerConfigured()) return NextResponse.json({ error: "Connecting PayPal isn't available here yet. Enter your PayPal email instead." }, { status: 503 });
    const actionUrl = await sellerSignupLink({
      sellerId: s.id,
      email: s.paypalMerchantEmail.includes("@") ? s.paypalMerchantEmail : user.email,
      returnUrl: `${appUrl()}/api/seller/paypal/return`,
      language: s.language,
    });
    return NextResponse.json({ actionUrl, scriptUrl: PARTNER_JS_URL });
  } catch (err) {
    return errorResponse(err);
  }
}
