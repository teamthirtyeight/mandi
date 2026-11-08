// Seller sign-up into PayPal without leaving Mandi (PayPal Partner Referrals).
//
// 1. A seller clicks "Connect PayPal". Mandi asks PayPal for a sign-up link
//    (POST /v2/customer/partner-referrals) carrying the seller's id as tracking_id.
// 2. PayPal's sign-up opens in a PayPal window over Mandi (mini-browser). The
//    seller logs in, or creates a PayPal business account if they have none.
// 3. PayPal sends the browser back to /api/seller/paypal/return with the
//    seller's PayPal merchant id. Mandi never trusts those query parameters:
//    it asks PayPal for that merchant's status, checks the tracking_id is this
//    seller, and only then saves the merchant id and email used for payouts.
//
// These calls need a PayPal *platform* app (PAYPAL_PARTNER_CLIENT_ID/SECRET);
// payments and payouts stay on the main app's credentials (./rest.ts).
import { logPaypalEvent } from "./log";
import { PaypalError } from "./rest";

const BASE_URL = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

/** PayPal's script that opens the sign-up link as a window over the page. */
export const PARTNER_JS_URL =
  process.env.PAYPAL_ENV === "live"
    ? "https://www.paypal.com/webapps/merchantboarding/js/lib/lightbox/partner.js"
    : "https://www.sandbox.paypal.com/webapps/merchantboarding/js/lib/lightbox/partner.js";

export const partnerConfigured = () => Boolean(process.env.PAYPAL_PARTNER_CLIENT_ID && process.env.PAYPAL_PARTNER_CLIENT_SECRET);

let cachedToken: { value: string; expiresAt: number } | null = null;
let cachedPartnerId: string | null = null;

async function partnerToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (!partnerConfigured()) throw new PaypalError("PayPal seller sign-up isn't set up: set PAYPAL_PARTNER_CLIENT_ID and PAYPAL_PARTNER_CLIENT_SECRET", 503, null);
  const auth = Buffer.from(`${process.env.PAYPAL_PARTNER_CLIENT_ID}:${process.env.PAYPAL_PARTNER_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new PaypalError("PayPal platform sign-in failed", res.status, body);
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

// PayPal bodies are large and loosely shaped; callers read the few fields they need.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

async function partnerRequest(method: "GET" | "POST", path: string, summary: (ok: boolean, b: Body) => string, body?: unknown): Promise<Body> {
  const send = async () =>
    fetch(`${BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await partnerToken()}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  let res = await send();
  if (res.status === 401) {
    cachedToken = null;
    res = await send();
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  await logPaypalEvent({ direction: "call", method, endpoint: path.split("?")[0], httpStatus: res.status, summary: summary(res.ok, json) });
  if (!res.ok) {
    const detail = json?.details?.[0]?.issue ?? json?.name ?? res.status;
    throw new PaypalError(`PayPal ${method} ${path.split("?")[0]} failed: ${detail}`, res.status, json);
  }
  return json;
}

/**
 * Mandi's own PayPal merchant id as a platform. PAYPAL_PARTNER_MERCHANT_ID if
 * set; otherwise read once from the default payee of an order the platform
 * app creates (it's never approved or paid, and expires on its own).
 */
export async function partnerMerchantId(): Promise<string> {
  if (process.env.PAYPAL_PARTNER_MERCHANT_ID) return process.env.PAYPAL_PARTNER_MERCHANT_ID;
  if (cachedPartnerId) return cachedPartnerId;
  const order = await partnerRequest("POST", "/v2/checkout/orders", (ok) => (ok ? "Looked up Mandix's platform merchant id" : "Platform id lookup failed"), {
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "GBP", value: "1.00" } }],
  });
  const id = order?.purchase_units?.[0]?.payee?.merchant_id;
  if (!id) throw new PaypalError("PayPal didn't return Mandix's platform merchant id", 502, order);
  cachedPartnerId = id as string;
  return cachedPartnerId;
}

/** A PayPal sign-up link for this seller, to open in PayPal's window over Mandi. */
export async function sellerSignupLink(input: { sellerId: string; email?: string | null; returnUrl: string; language?: string }) {
  const body = await partnerRequest(
    "POST",
    "/v2/customer/partner-referrals",
    (ok) => (ok ? "Seller sign-up link created" : "Seller sign-up link failed"),
    {
      tracking_id: input.sellerId,
      ...(input.email ? { email: input.email } : {}),
      preferred_language_code: input.language === "hi" ? "en-IN" : "en-GB",
      partner_config_override: { return_url: input.returnUrl, return_url_description: "Back to Mandix" },
      operations: [
        {
          operation: "API_INTEGRATION",
          api_integration_preference: {
            rest_api_integration: {
              integration_method: "PAYPAL",
              integration_type: "THIRD_PARTY",
              third_party_details: { features: ["PAYMENT", "REFUND"] },
            },
          },
        },
      ],
      products: ["EXPRESS_CHECKOUT"],
      legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
    },
  );
  const href = (body?.links ?? []).find((l: { rel: string }) => l.rel === "action_url")?.href as string | undefined;
  if (!href) throw new PaypalError("PayPal returned no sign-up link", 502, body);
  // Opens as a window over Mandi rather than a full-page redirect.
  return `${href}${href.includes("?") ? "&" : "?"}displayMode=minibrowser`;
}

export interface SellerPaypalStatus {
  merchantId: string;
  trackingId: string | null;
  email: string | null;
  emailConfirmed: boolean;
  paymentsReceivable: boolean;
}

/** What PayPal itself says about a merchant that signed up through Mandi. */
export async function sellerPaypalStatus(merchantId: string): Promise<SellerPaypalStatus> {
  const partnerId = await partnerMerchantId();
  const b = await partnerRequest(
    "GET",
    `/v1/customer/partners/${partnerId}/merchant-integrations/${encodeURIComponent(merchantId)}`,
    (ok, b) => (ok ? `Seller PayPal account: ${b?.payments_receivable ? "can receive payments" : "not ready to receive payments"}` : "Seller status lookup failed"),
  );
  return {
    merchantId: b.merchant_id ?? merchantId,
    trackingId: b.tracking_id ?? null,
    email: b.primary_email ?? null,
    emailConfirmed: Boolean(b.primary_email_confirmed),
    paymentsReceivable: Boolean(b.payments_receivable),
  };
}

/** The merchant id for a seller who finished sign-up, found by tracking id (when the return link was lost). */
export async function merchantIdForSeller(sellerId: string): Promise<string | null> {
  const partnerId = await partnerMerchantId();
  try {
    const b = await partnerRequest("GET", `/v1/customer/partners/${partnerId}/merchant-integrations?tracking_id=${encodeURIComponent(sellerId)}`, (ok) =>
      ok ? "Found seller's PayPal sign-up" : "No PayPal sign-up for this seller yet",
    );
    return (b?.merchant_id as string | undefined) ?? null;
  } catch (err) {
    if (err instanceof PaypalError && err.status === 404) return null;
    throw err;
  }
}
