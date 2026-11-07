// Registers Mandi's PayPal webhook for a deployed URL and prints its id for
// PAYPAL_WEBHOOK_ID. Run once after deploying:
//   PUBLIC_URL=https://mandi.onrender.com npm run paypal:webhook
// Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_ENV from the environment.
import "dotenv/config";

const EVENTS = [
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  // Custom orders, Mandi Monthly and seller payouts.
  "INVOICING.INVOICE.PAID",
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
];

async function main() {
  const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, "");
  if (!publicUrl?.startsWith("https://")) throw new Error("Set PUBLIC_URL to the deployed https URL");
  const base = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");

  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) throw new Error(`OAuth failed: ${tokenRes.status}`);
  const { access_token } = await tokenRes.json();

  const url = `${publicUrl}/api/paypal/webhook`;
  const headers = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" };

  // Already registered for this URL: update its events instead of adding a second webhook.
  const existing = (await (await fetch(`${base}/v1/notifications/webhooks`, { headers })).json()).webhooks?.find((w: { url: string }) => w.url === url);
  if (existing) {
    const patch = await fetch(`${base}/v1/notifications/webhooks/${existing.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify([{ op: "replace", path: "/event_types", value: EVENTS.map((name) => ({ name })) }]),
    });
    const body = await patch.json();
    if (!patch.ok) throw new Error(`Update failed (${patch.status}): ${JSON.stringify(body.details ?? body)}`);
    console.log(`Webhook ${existing.id} for ${url} now listens to ${EVENTS.length} events`);
    return;
  }

  const res = await fetch(`${base}/v1/notifications/webhooks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, event_types: EVENTS.map((name) => ({ name })) }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Register failed (${res.status}): ${JSON.stringify(body.details ?? body)}`);
  console.log(`Webhook registered for ${url}`);
  console.log(`Set PAYPAL_WEBHOOK_ID=${body.id}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
