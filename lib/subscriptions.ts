// Mandi Monthly: one handmade piece a month from a different artisan, as a
// PayPal subscription. Plan, subscription, status and cancellation all go
// through the PayPal Agent Toolkit (platform toolkit, fixed server code).
// Each monthly payment pays that month's artisan through PayPal Payouts.
//
// The toolkit's subscription plans are priced in USD, so Mandi Monthly is too.
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { appUrl, notifyUser } from "@/lib/notify";
import { createPayout } from "@/lib/paypal/rest";
import { runPlatformTool } from "@/lib/paypal/toolkit";
import { feePct, payoutSplit } from "@/lib/orders/payout-split";
import { sellerLanguage, SELLER_STRINGS } from "@/lib/i18n/seller";
import { sendWhatsApp } from "@/lib/whatsapp";

export const MONTHLY_PRICE_USD = "45.00";
const PLAN_KEY = "mandi_monthly_plan_id";

async function setting(key: string) {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key));
  return row?.value ?? null;
}

/** Creates the PayPal catalog product and monthly plan once, then reuses them. */
export async function ensurePlan(): Promise<string> {
  const existing = await setting(PLAN_KEY);
  if (existing) return existing;
  const product = await runPlatformTool<{ id: string }>(
    "create_product",
    {
      name: "Mandi Monthly",
      type: "PHYSICAL",
      description: "One handmade piece a month from a different artisan in India.",
      category: "ARTS_AND_CRAFTS",
      // PayPal accepts only public https links here.
      ...(appUrl().startsWith("https://") ? { home_url: `${appUrl()}/monthly` } : {}),
    },
    { label: "Mandi Monthly product" },
  );
  const plan = await runPlatformTool<{ id: string }>(
    "create_subscription_plan",
    {
      product_id: product.id,
      name: "Mandi Monthly",
      description: "A handmade piece every month, shipped from India.",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { currency_code: "USD", value: MONTHLY_PRICE_USD } },
        },
      ],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
    },
    { label: "Mandi Monthly plan" },
  );
  await db.insert(schema.appSettings).values({ key: PLAN_KEY, value: plan.id }).onConflictDoNothing();
  return (await setting(PLAN_KEY)) ?? plan.id;
}

/** This month's artisan: sellers with a maker profile, in turn, one per calendar month. */
export async function monthArtisan(now = new Date()) {
  const makers = await db
    .select()
    .from(schema.sellers)
    .where(and(isNotNull(schema.sellers.photoUrl), isNotNull(schema.sellers.craft)))
    .orderBy(asc(schema.sellers.createdAt), asc(schema.sellers.name), asc(schema.sellers.id)); // fixed order: seeded makers share a createdAt
  if (makers.length === 0) return null;
  const monthIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return makers[monthIndex % makers.length];
}

/** Starts a subscription and returns PayPal's approval link for the buyer. */
export async function subscribe(user: { id: string; name: string; email: string }) {
  const planId = await ensurePlan();
  const sub = await runPlatformTool<{ id: string; status: string; links?: { href: string; rel: string }[] }>(
    "create_subscription",
    {
      plan_id: planId,
      subscriber: { name: { given_name: user.name }, email_address: user.email },
      application_context: {
        brand_name: "Mandi",
        user_action: "SUBSCRIBE_NOW",
        shipping_preference: "GET_FROM_FILE",
        return_url: `${appUrl()}/monthly?subscribed=1`,
        cancel_url: `${appUrl()}/monthly`,
      },
    },
    { label: `subscribe ${user.name}` },
  );
  const approveUrl = sub.links?.find((l) => l.rel === "approve")?.href ?? null;
  await db
    .insert(schema.subscriptions)
    .values({ buyerUserId: user.id, paypalSubscriptionId: sub.id, status: sub.status ?? "APPROVAL_PENDING", approveUrl })
    .onConflictDoNothing();
  return { id: sub.id, approveUrl };
}

/** The buyer's latest subscription, checked with PayPal if it isn't settled yet. */
export async function currentSubscription(userId: string) {
  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.buyerUserId, userId))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);
  if (!row) return null;
  if (["APPROVAL_PENDING", "APPROVED"].includes(row.status)) return refreshSubscription(row.paypalSubscriptionId);
  return row;
}

export async function refreshSubscription(paypalSubscriptionId: string) {
  const details = await runPlatformTool<{ status?: string }>(
    "show_subscription_details",
    { subscription_id: paypalSubscriptionId },
    { label: "subscription status" },
  );
  const [row] = await db
    .update(schema.subscriptions)
    .set({ status: details.status ?? "UNKNOWN" })
    .where(eq(schema.subscriptions.paypalSubscriptionId, paypalSubscriptionId))
    .returning();
  return row ?? null;
}

export async function cancelSubscription(userId: string) {
  const sub = await currentSubscription(userId);
  if (!sub || !["ACTIVE", "SUSPENDED", "APPROVED"].includes(sub.status)) return sub;
  await runPlatformTool(
    "cancel_subscription",
    { subscription_id: sub.paypalSubscriptionId, payload: { reason: "Cancelled by the subscriber on Mandi" } },
    { label: "cancel subscription" },
  );
  return refreshSubscription(sub.paypalSubscriptionId);
}

/**
 * A monthly payment arrived (PAYMENT.SALE.COMPLETED): pay this month's artisan
 * their share. The sale id makes the payout batch id, so a repeated webhook
 * can't pay twice.
 */
export async function monthlyPaymentReceived(input: { saleId: string; subscriptionId: string; amount: string; currency: string }) {
  const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.paypalSubscriptionId, input.subscriptionId));
  if (!sub) return null;
  const artisan = await monthArtisan();
  if (!artisan) return null;
  const amountMinor = Math.round(Number(input.amount) * 100);
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return null;
  const split = payoutSplit({ capturedMinor: amountMinor, refundedMinor: 0, debtMinor: 0, feePct: feePct() });
  const payout = await createPayout({
    senderBatchId: `mandi-monthly-${input.saleId}`,
    receiverEmail: artisan.paypalMerchantEmail,
    amountMinor: split.payoutMinor,
    currency: input.currency,
    subject: "Mandi Monthly: you're this month's artisan",
    note: `A Mandi Monthly subscriber's payment, after Mandi's ${feePct()}% fee. Please send them one of your pieces this month.`,
  });
  if (artisan.whatsappOptIn && artisan.whatsappNumber) {
    const t = SELLER_STRINGS[sellerLanguage(artisan.language)];
    const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: input.currency }).format(split.payoutMinor / 100);
    await sendWhatsApp({ sellerId: artisan.id, to: artisan.whatsappNumber, body: `*${t.paidOut(usd)}*\nMandi Monthly. ${t.paidOutBody}` });
  }
  await notifyUser(sub.buyerUserId, "Mandi Monthly: payment received", `This month's piece comes from ${artisan.name}, ${artisan.city}.`, "/monthly");
  return { payoutBatchId: payout.batchId, artisan: artisan.name };
}
