// Saves a seller's PayPal account once PayPal confirms it (see lib/paypal/partner.ts).
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { merchantIdForSeller, sellerPaypalStatus, type SellerPaypalStatus } from "@/lib/paypal/partner";
import { retryFailedPayouts } from "@/lib/orders/payout";

export type ConnectOutcome =
  | { ok: true; status: SellerPaypalStatus; retried: number }
  | { ok: false; reason: "not_found" | "other_seller" };

/**
 * Checks with PayPal that `merchantId` signed up through this seller's link
 * (tracking_id = seller id), then stores it and its email for payouts. Payouts
 * that failed for lack of an account are sent again.
 */
export async function connectSellerPaypal(sellerId: string, merchantId?: string | null): Promise<ConnectOutcome> {
  const id = merchantId || (await merchantIdForSeller(sellerId));
  if (!id) return { ok: false, reason: "not_found" };
  const status = await sellerPaypalStatus(id);
  if (status.trackingId && status.trackingId !== sellerId) return { ok: false, reason: "other_seller" };

  const ready = status.paymentsReceivable && status.emailConfirmed;
  await db
    .update(schema.sellers)
    .set({
      paypalMerchantId: status.merchantId,
      paypalConnectStatus: ready ? "connected" : "needs_attention",
      paypalConnectedAt: new Date(),
      // Payouts go to the account's email; keep the old one if PayPal didn't share it.
      ...(status.email ? { paypalMerchantEmail: status.email.toLowerCase() } : {}),
    })
    .where(eq(schema.sellers.id, sellerId));
  // Payouts can now go to the merchant id, email or not.
  const retried = await retryFailedPayouts(sellerId);
  return { ok: true, status, retried };
}
