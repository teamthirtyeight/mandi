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
