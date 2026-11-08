// Deterministic PayPal money calls. No LLM ever imports this module; agents can
// only propose, the payment service acts. Every money POST carries a
// PayPal-Request-Id so retries can't double-charge.
//
// Orders v2 and Payments v2 (create, authorize, show, track, capture, refund,
// void, reauthorize) go through PayPal's Server SDK, @paypal/paypal-server-sdk,
// which APIMatic generates (see ./sdk.ts). Payouts, disputes and webhook
// verification aren't in that SDK, so they stay as direct REST calls below.
import { randomUUID } from "node:crypto";
import { CheckoutPaymentIntent, ItemCategory, ShipmentCarrier } from "@paypal/paypal-server-sdk";
import { logPaypalEvent } from "./log";
import { controllers, runSdk, type SdkOutcome } from "./sdk";

const BASE_URL =
  process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export class PaypalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/** Integer minor units → PayPal's decimal string ("7200" → "72.00"). */
export const toValue = (minor: number) => {
  if (!Number.isInteger(minor) || minor < 0) throw new Error(`Invalid minor amount: ${minor}`);
  return (minor / 100).toFixed(2);
};

// ---- OAuth token, cached until shortly before expiry ----

let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new PaypalError("PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET", 503, null);

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const body = await res.json();
  await logPaypalEvent({
    direction: "call",
    method: "POST",
    endpoint: "/v1/oauth2/token",
    httpStatus: res.status,
    summary: res.ok ? "Access token issued" : "Token request failed",
  });
  if (!res.ok) throw new PaypalError("PayPal OAuth failed", res.status, body);

  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

// ---- Core request helper ----

// PayPal response bodies are large and loosely shaped; callers read the few fields they need.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PaypalBody = any;

interface RequestOpts {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** Idempotency key. Pass a stable one (e.g. per deal) so a double click reuses it. */
  requestId?: string;
  orderId?: string | null;
  summary: (ok: boolean, body: PaypalBody) => string;
}

async function paypalRequest<T = PaypalBody>(opts: RequestOpts): Promise<T> {
  const requestId = opts.method === "POST" ? (opts.requestId ?? randomUUID()) : null;
  const send = async () => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    return fetch(`${BASE_URL}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
      cache: "no-store",
    });
  };

  let res = await send();
  // A revoked or expired token: get a new one and try once more (same request id,
  // so it's still safe for POSTs; PayPal didn't process the refused request).
  if (res.status === 401) {
    cachedToken = null;
    res = await send();
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  await logPaypalEvent({
    direction: "call",
    method: opts.method,
    endpoint: opts.path,
    httpStatus: res.status,
    orderId: opts.orderId,
    summary: opts.summary(res.ok, body),
  });

  if (!res.ok) {
    const detail = body?.details?.[0]?.issue ?? body?.name ?? res.statusText;
    throw new PaypalError(`PayPal ${opts.method} ${opts.path} failed: ${detail}`, res.status, body);
  }
  return body as T;
}

// ---- SDK call helper (Orders + Payments) ----

interface SdkOpts {
  method: "GET" | "POST";
  /** Path for the log, e.g. /v2/checkout/orders/{id}/authorize. */
  path: string;
  orderId?: string | null;
  /** Idempotency key for SDK methods that take no paypalRequestId of their own. */
  requestId?: string;
  summary: (ok: boolean, body: PaypalBody) => string;
  call: (c: ReturnType<typeof controllers>) => Promise<{ statusCode: number; body: unknown }>;
}

async function sdkRequest<T = PaypalBody>(opts: SdkOpts): Promise<T> {
  const send = async (): Promise<SdkOutcome> => runSdk(async () => opts.call(controllers(await getAccessToken(), opts.requestId ? { "PayPal-Request-Id": opts.requestId } : {})));
  let res = await send();
  // Revoked or expired token: new token, one more try (same request id, so still safe).
  if (res.status === 401) {
    cachedToken = null;
    res = await send();
  }
  const ok = res.status >= 200 && res.status < 300;
  await logPaypalEvent({
    direction: "call",
    method: opts.method,
    endpoint: opts.path,
    httpStatus: res.status,
    orderId: opts.orderId,
    summary: `${opts.summary(ok, res.body)} (PayPal Server SDK)`,
  });
  if (!ok) {
    const detail = res.body?.details?.[0]?.issue ?? res.body?.name ?? res.status;
    throw new PaypalError(`PayPal ${opts.method} ${opts.path} failed: ${detail}`, res.status, res.body);
  }
  return res.body as T;
}

const PREFER = "return=representation";

// ---- Orders v2 ----

export interface CreateOrderInput {
  amountMinor: number;
  currency: string;
  itemName: string;
  /** Line items when the order has more than one (e.g. a bundle). Must sum to amountMinor. */
  items?: { name: string; amountMinor: number }[];
  description?: string;
  /** Seller's sandbox business account. Omit to pay the Mandix merchant itself. */
  payeeEmail?: string;
  referenceId: string;
  requestId: string;
  orderId?: string | null;
}

export async function createAuthorizeOrder(input: CreateOrderInput) {
  const value = toValue(input.amountMinor);
  const lines = input.items ?? [{ name: input.itemName, amountMinor: input.amountMinor }];
  if (lines.reduce((sum, l) => sum + l.amountMinor, 0) !== input.amountMinor) {
    throw new Error("Order items don't add up to the order amount");
  }
  return sdkRequest<{ id: string; status: string }>({
    method: "POST",
    path: "/v2/checkout/orders",
    orderId: input.orderId,
    call: ({ orders }) =>
      orders.createOrder({
        paypalRequestId: input.requestId,
        prefer: PREFER,
        body: {
          intent: CheckoutPaymentIntent.Authorize,
          purchaseUnits: [
            {
              referenceId: input.referenceId,
              description: input.description?.slice(0, 127),
              amount: {
                currencyCode: input.currency,
                value,
                breakdown: { itemTotal: { currencyCode: input.currency, value } },
              },
              items: lines.map((l) => ({
                name: l.name.slice(0, 127),
                quantity: "1",
                unitAmount: { currencyCode: input.currency, value: toValue(l.amountMinor) },
                category: ItemCategory.PhysicalGoods,
              })),
              ...(input.payeeEmail ? { payee: { emailAddress: input.payeeEmail } } : {}),
            },
          ],
        },
      }),
    summary: (ok, b) => (ok ? `Order ${b.id} created (AUTHORIZE, ${input.currency} ${value})` : "Create order failed"),
  });
}

export interface ShippingAddress {
  name: string | null;
  lines: string[];
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
}

/** The buyer's shipping address from a PayPal order body (collected in the popup). */
export function shippingFrom(body: PaypalBody): ShippingAddress | null {
  const s = body?.purchase_units?.[0]?.shipping;
  const a = s?.address;
  if (!a) return null;
  return {
    name: s.name?.full_name ?? null,
    lines: [a.address_line_1, a.address_line_2].filter(Boolean),
    city: a.admin_area_2 ?? null,
    region: a.admin_area_1 ?? null,
    postalCode: a.postal_code ?? null,
    countryCode: a.country_code ?? null,
  };
}

export async function authorizeOrder(paypalOrderId: string, opts: { orderId?: string | null } = {}) {
  const body = await sdkRequest({
    method: "POST",
    path: `/v2/checkout/orders/${paypalOrderId}/authorize`,
    orderId: opts.orderId,
    call: ({ orders }) => orders.authorizeOrder({ id: paypalOrderId, paypalRequestId: `authorize-${paypalOrderId}`, prefer: PREFER }),
    summary: (ok, b) => {
      const auth = b?.purchase_units?.[0]?.payments?.authorizations?.[0];
      return ok && auth ? `Authorized ${auth.amount.currency_code} ${auth.amount.value} — money held` : "Authorize failed";
    },
  });
  const auth = body.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth?.id) throw new PaypalError("Authorize returned no authorization id", 500, body);
  return {
    authorizationId: auth.id as string,
    status: auth.status as string,
    expirationTime: auth.expiration_time as string | undefined,
    shipping: shippingFrom(body),
    raw: body,
  };
}

export async function getOrder(paypalOrderId: string, opts: { orderId?: string | null } = {}) {
  return sdkRequest({
    method: "GET",
    path: `/v2/checkout/orders/${paypalOrderId}`,
    orderId: opts.orderId,
    call: ({ orders }) => orders.getOrder({ id: paypalOrderId }),
    summary: (ok, b) => (ok ? `Order ${paypalOrderId} is ${b.status}` : "Show order failed"),
  });
}

/** Attach tracking. PayPal applies this to captured orders, so call it after capture. */
export async function addTracking(input: {
  paypalOrderId: string;
  captureId: string;
  trackingNumber: string;
  carrier: string;
  carrierNameOther?: string;
  orderId?: string | null;
}) {
  return sdkRequest({
    method: "POST",
    path: `/v2/checkout/orders/${input.paypalOrderId}/track`,
    requestId: `track-${input.captureId}-${input.trackingNumber}`,
    orderId: input.orderId,
    call: ({ orders }) =>
      orders.createOrderTracking({
        id: input.paypalOrderId,
        body: {
          captureId: input.captureId,
          trackingNumber: input.trackingNumber,
          // PayPal's carrier codes; the SDK schema accepts codes newer than its enum.
          carrier: input.carrier as ShipmentCarrier,
          ...(input.carrier === "OTHER" ? { carrierNameOther: input.carrierNameOther ?? "Other" } : {}),
          notifyPayer: true,
        },
      }),
    summary: (ok) => (ok ? `Tracking ${input.trackingNumber} attached` : "Add tracking failed"),
  });
}

// ---- Payments v2 ----

export async function captureAuthorization(authorizationId: string, opts: { orderId?: string | null } = {}) {
  const body = await sdkRequest({
    method: "POST",
    path: `/v2/payments/authorizations/${authorizationId}/capture`,
    orderId: opts.orderId,
    call: ({ payments }) =>
      payments.captureAuthorizedPayment({ authorizationId, paypalRequestId: `capture-${authorizationId}`, prefer: PREFER, body: { finalCapture: true } }),
    summary: (ok, b) => (ok ? `Captured ${b.amount?.currency_code ?? ""} ${b.amount?.value ?? ""}`.trim() : "Capture failed"),
  });
  return { captureId: body.id as string, status: body.status as string, raw: body };
}

export async function refundCapture(input: {
  captureId: string;
  amountMinor: number;
  currency: string;
  requestId: string;
  note?: string;
  orderId?: string | null;
}) {
  const value = toValue(input.amountMinor);
  const body = await sdkRequest({
    method: "POST",
    path: `/v2/payments/captures/${input.captureId}/refund`,
    orderId: input.orderId,
    call: ({ payments }) =>
      payments.refundCapturedPayment({
        captureId: input.captureId,
        paypalRequestId: input.requestId,
        prefer: PREFER,
        body: {
          amount: { currencyCode: input.currency, value },
          ...(input.note ? { noteToPayer: input.note.slice(0, 255) } : {}),
        },
      }),
    summary: (ok) => (ok ? `Refunded ${input.currency} ${value}` : "Refund failed"),
  });
  return { refundId: body.id as string, status: body.status as string, raw: body };
}

export async function voidAuthorization(authorizationId: string, opts: { orderId?: string | null } = {}) {
  await sdkRequest({
    method: "POST",
    path: `/v2/payments/authorizations/${authorizationId}/void`,
    orderId: opts.orderId,
    call: ({ payments }) => payments.voidPayment({ authorizationId, paypalRequestId: `void-${authorizationId}` }),
    summary: (ok) => (ok ? "Authorization voided — hold released" : "Void failed"),
  });
}

/**
 * Renews a hold for a seller who needs more time. PayPal allows this once the
 * 3-day honor period has passed and within 29 days of the original
 * authorization; earlier or later, PayPal refuses and the message says why.
 */
export async function reauthorize(authorizationId: string, opts: { orderId?: string | null } = {}) {
  const body = await sdkRequest({
    method: "POST",
    path: `/v2/payments/authorizations/${authorizationId}/reauthorize`,
    orderId: opts.orderId,
    call: ({ payments }) =>
      payments.reauthorizePayment({ authorizationId, paypalRequestId: `reauthorize-${authorizationId}`, prefer: PREFER }),
    summary: (ok, b) => (ok ? `Hold renewed (${b.id})` : "Reauthorize failed"),
  });
  return { authorizationId: body.id as string, expirationTime: body.expiration_time as string | undefined };
}

// ---- Disputes ----

/** Sends proof of shipment and notes to a PayPal dispute (multipart, JSON part only). */
export async function provideDisputeEvidence(input: {
  disputeId: string;
  carrierName: string;
  trackingNumber: string;
  notes: string;
  orderId?: string | null;
}) {
  const token = await getAccessToken();
  const form = new FormData();
  form.append(
    "input",
    new Blob(
      [
        JSON.stringify({
          evidences: [
            {
              evidence_type: "PROOF_OF_FULFILLMENT",
              evidence_info: { tracking_info: [{ carrier_name: input.carrierName, tracking_number: input.trackingNumber }] },
              notes: input.notes.slice(0, 2000),
            },
          ],
        }),
      ],
      { type: "application/json" },
    ),
  );
  const path = `/v1/customer/disputes/${input.disputeId}/provide-evidence`;
  const res = await fetch(`${BASE_URL}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, cache: "no-store" });
  const text = await res.text();
  await logPaypalEvent({
    direction: "call",
    method: "POST",
    endpoint: path,
    httpStatus: res.status,
    orderId: input.orderId,
    summary: res.ok ? "Dispute evidence sent" : "Dispute evidence failed",
  });
  if (!res.ok) {
    const body = text ? JSON.parse(text) : null;
    throw new PaypalError(`PayPal dispute evidence failed: ${body?.details?.[0]?.issue ?? body?.name ?? res.status}`, res.status, body);
  }
}

// ---- Payouts ----

/**
 * Sends one seller payout. sender_batch_id is per order, so PayPal itself
 * refuses a second batch for the same order: a retry can't pay twice.
 */
export async function createPayout(input: {
  senderBatchId: string;
  receiverEmail: string;
  /** The seller's PayPal merchant id (from Connect PayPal). Preferred over the email when set. */
  receiverPaypalId?: string | null;
  amountMinor: number;
  currency: string;
  note: string;
  subject: string;
  orderId?: string | null;
}) {
  const body = await paypalRequest({
    method: "POST",
    path: "/v1/payments/payouts",
    requestId: input.senderBatchId,
    orderId: input.orderId,
    body: {
      sender_batch_header: { sender_batch_id: input.senderBatchId, email_subject: input.subject.slice(0, 255) },
      items: [
        {
          recipient_type: input.receiverPaypalId ? "PAYPAL_ID" : "EMAIL",
          receiver: input.receiverPaypalId || input.receiverEmail,
          amount: { value: toValue(input.amountMinor), currency: input.currency },
          note: input.note.slice(0, 4000),
          sender_item_id: input.senderBatchId,
        },
      ],
    },
    summary: (ok, b) =>
      ok ? `Payout ${b.batch_header?.payout_batch_id} sent (${input.currency} ${toValue(input.amountMinor)})` : "Payout failed",
  });
  return { batchId: body.batch_header.payout_batch_id as string, status: body.batch_header.batch_status as string };
}

/** Current state of a payout: the batch status, or the item's once PayPal has processed it. */
export async function getPayout(batchId: string, opts: { orderId?: string | null } = {}) {
  const body = await paypalRequest({
    method: "GET",
    path: `/v1/payments/payouts/${batchId}`,
    orderId: opts.orderId,
    summary: (ok, b) => (ok ? `Payout ${batchId}: ${b.items?.[0]?.transaction_status ?? b.batch_header?.batch_status}` : "Payout lookup failed"),
  });
  const item = body.items?.[0];
  return {
    status: (item?.transaction_status ?? body.batch_header?.batch_status) as string,
    error: (item?.errors?.message as string | undefined) ?? null,
  };
}

// ---- Webhooks ----

export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const body = await paypalRequest<{ verification_status: string }>({
    method: "POST",
    path: "/v1/notifications/verify-webhook-signature",
    body: {
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    },
    summary: (ok, b) => (ok ? `Webhook signature ${b.verification_status}` : "Webhook verification failed"),
  });
  return body.verification_status === "SUCCESS";
}
