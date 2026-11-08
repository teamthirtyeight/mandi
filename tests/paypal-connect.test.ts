// Seller sign-up into PayPal (lib/paypal/partner.ts, lib/sellers/paypal-connect.ts),
// with PayPal mocked at fetch. The return link's merchant id is only a hint:
// Mandi saves an account only after PayPal confirms it signed up through this seller.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sellerWithOrder, TRUNCATE_ALL } from "./helpers/fixtures";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("connect a seller's PayPal account", () => {
  let dbmod: typeof import("@/lib/db");
  let merchants: Record<string, { tracking_id: string; primary_email?: string; primary_email_confirmed: boolean; payments_receivable: boolean }>;
  let referralBody: Record<string, unknown> | null;
  let payouts: string[];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.PAYPAL_CLIENT_ID = "test-id";
    process.env.PAYPAL_CLIENT_SECRET = "test-secret";
    process.env.PAYPAL_PARTNER_CLIENT_ID = "partner-id";
    process.env.PAYPAL_PARTNER_CLIENT_SECRET = "partner-secret";
    process.env.PAYPAL_PARTNER_MERCHANT_ID = "MANDIPARTNER";
    process.env.MANDI_FAKE_AI = "1";
    delete process.env.TWILIO_ACCOUNT_SID;
    dbmod = await import("@/lib/db");
  });

  beforeEach(async () => {
    merchants = {};
    referralBody = null;
    payouts = [];
    const { sql } = await import("drizzle-orm");
    await dbmod.db.execute(sql.raw(TRUNCATE_ALL));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const u = new URL(url);
        const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
        if (u.pathname === "/v1/oauth2/token") return json(200, { access_token: "tok", expires_in: 3600 });
        if (u.pathname === "/v2/customer/partner-referrals") {
          referralBody = JSON.parse(String(init.body));
          return json(201, { links: [{ rel: "action_url", href: "https://www.sandbox.paypal.com/bizsignup/partner/entry?referralToken=abc" }] });
        }
        const m = u.pathname.match(/^\/v1\/customer\/partners\/MANDIPARTNER\/merchant-integrations\/?(.*)$/);
        if (m) {
          const id = m[1] || Object.keys(merchants).find((k) => merchants[k].tracking_id === u.searchParams.get("tracking_id"));
          const found = id ? merchants[id] : undefined;
          return found ? json(200, { merchant_id: id, ...found }) : json(404, { name: "RESOURCE_NOT_FOUND" });
        }
        if (u.pathname === "/v1/payments/payouts") {
          const body = JSON.parse(String(init.body));
          payouts.push(`${body.items[0].recipient_type}:${body.items[0].receiver}`);
          return json(201, { batch_header: { payout_batch_id: `B-${payouts.length}`, batch_status: "PENDING" } });
        }
        return json(404, { name: "NOT_FOUND" });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const seller = async (sellerId: string) => {
    const { eq } = await import("drizzle-orm");
    const [s] = await dbmod.db.select().from(dbmod.schema.sellers).where(eq(dbmod.schema.sellers.id, sellerId));
    return s;
  };

  it("asks PayPal for a sign-up link tied to the seller, opening over Mandi", async () => {
    const { sellerSignupLink } = await import("@/lib/paypal/partner");
    const link = await sellerSignupLink({ sellerId: "seller-1", email: "meera@example.com", returnUrl: "https://mandi.test/api/seller/paypal/return" });
    expect(link).toContain("displayMode=minibrowser");
    expect(referralBody).toMatchObject({
      tracking_id: "seller-1",
      email: "meera@example.com",
      partner_config_override: { return_url: "https://mandi.test/api/seller/paypal/return" },
      products: ["EXPRESS_CHECKOUT"],
    });
  });

  it("saves a confirmed account, its email for payouts, and resends failed payouts there", async () => {
    const { seller: s, order } = await sellerWithOrder(dbmod, { seller: { paypalMerchantEmail: "" } });
    const { eq } = await import("drizzle-orm");
    await dbmod.db.update(dbmod.schema.orders).set({ status: "CAPTURED", captureId: "CAP-1", payoutStatus: "FAILED", payoutError: "Receiver is invalid" }).where(eq(dbmod.schema.orders.id, order.id));
    merchants.NEWMERCHANT = { tracking_id: s.id, primary_email: "Kavya@Business.Example.com", primary_email_confirmed: true, payments_receivable: true };

    const { connectSellerPaypal } = await import("@/lib/sellers/paypal-connect");
    const out = await connectSellerPaypal(s.id, "NEWMERCHANT");
    expect(out.ok).toBe(true);

    const after = await seller(s.id);
    expect(after.paypalMerchantId).toBe("NEWMERCHANT");
    expect(after.paypalConnectStatus).toBe("connected");
    expect(after.paypalMerchantEmail).toBe("kavya@business.example.com");
    // Paid to the PayPal account itself, which works even when PayPal shares no email.
    expect(payouts).toEqual(["PAYPAL_ID:NEWMERCHANT"]);
  });

  it("refuses a merchant id that signed up through another seller's link", async () => {
    const { seller: s } = await sellerWithOrder(dbmod);
    merchants.SOMEONEELSE = { tracking_id: "a-different-seller", primary_email: "x@example.com", primary_email_confirmed: true, payments_receivable: true };
    const { connectSellerPaypal } = await import("@/lib/sellers/paypal-connect");
    expect(await connectSellerPaypal(s.id, "SOMEONEELSE")).toEqual({ ok: false, reason: "other_seller" });
    const after = await seller(s.id);
    expect(after.paypalMerchantId).toBeNull();
    expect(after.paypalMerchantEmail).toBe("kavya@example.com");
  });

  it("finds the account by the seller's tracking id when the return link had none, and flags an unconfirmed email", async () => {
    const { seller: s } = await sellerWithOrder(dbmod);
    merchants.LATEMERCHANT = { tracking_id: s.id, primary_email: "kavya@new.example.com", primary_email_confirmed: false, payments_receivable: false };
    const { connectSellerPaypal } = await import("@/lib/sellers/paypal-connect");
    const out = await connectSellerPaypal(s.id, null);
    expect(out.ok).toBe(true);
    expect((await seller(s.id)).paypalConnectStatus).toBe("needs_attention");
  });

  it("links an account PayPal shares no email for, keeping the old email and paying by merchant id", async () => {
    const { seller: s } = await sellerWithOrder(dbmod, { seller: { paypalMerchantEmail: "" } });
    merchants.NOEMAIL = { tracking_id: s.id, primary_email_confirmed: false, payments_receivable: true };
    const { connectSellerPaypal } = await import("@/lib/sellers/paypal-connect");
    expect((await connectSellerPaypal(s.id, null)).ok).toBe(true);
    const after = await seller(s.id);
    expect(after.paypalMerchantId).toBe("NOEMAIL");
    expect(after.paypalMerchantEmail).toBe("");
    const { canPaySeller, payoutReceiver } = await import("@/lib/orders/payout-split");
    expect(canPaySeller(after)).toBe(true);
    expect(payoutReceiver(after)).toEqual({ receiverEmail: "", receiverPaypalId: "NOEMAIL" });
  });

  it("reports nothing found when the seller hasn't finished sign-up", async () => {
    const { seller: s } = await sellerWithOrder(dbmod);
    const { connectSellerPaypal } = await import("@/lib/sellers/paypal-connect");
    expect(await connectSellerPaypal(s.id, null)).toEqual({ ok: false, reason: "not_found" });
  });
});
