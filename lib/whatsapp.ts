// WhatsApp alerts for sellers, sent through Twilio's WhatsApp API.
//
// With TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM set, each
// message is sent for real. Without them, Mandix records the message as "logged"
// instead, so the flow works (and can be demoed) before an account exists.
// Every message, sent or not, is saved in whatsapp_messages.
//
// Twilio sandbox: the seller must first send the sandbox's "join <code>" message
// to TWILIO_WHATSAPP_FROM. WhatsApp only allows free-form business messages
// within 24 hours of the seller's last message; production needs approved
// message templates for each language.
import { db, schema } from "@/lib/db";

export { normalizeWhatsAppNumber } from "@/lib/phone";

export function whatsappLive(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
}

export type WhatsAppResult = typeof schema.whatsappMessages.$inferSelect;

export async function sendWhatsApp(input: {
  sellerId: string;
  orderId?: string | null;
  to: string;
  body: string;
  /** Public image to attach (the banner card); the text becomes its caption. */
  mediaUrl?: string | null;
}): Promise<WhatsAppResult> {
  const base = { sellerId: input.sellerId, orderId: input.orderId ?? null, to: input.to, body: input.body, mediaUrl: input.mediaUrl ?? null };

  if (!whatsappLive()) {
    console.log(`[whatsapp] not configured, logged instead → ${input.to}: ${input.body.split("\n")[0]}`);
    const [row] = await db.insert(schema.whatsappMessages).values({ ...base, status: "logged" }).returning();
    return row;
  }

  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const from = process.env.TWILIO_WHATSAPP_FROM!;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
        To: `whatsapp:${input.to}`,
        Body: input.body,
        ...(input.mediaUrl ? { MediaUrl: input.mediaUrl } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    const [row] = await db
      .insert(schema.whatsappMessages)
      .values(
        res.ok
          ? { ...base, status: "sent", providerId: json.sid ?? null }
          : { ...base, status: "failed", error: `Twilio ${json.code ?? res.status}: ${json.message ?? res.statusText}` },
      )
      .returning();
    return row;
  } catch (err) {
    const [row] = await db
      .insert(schema.whatsappMessages)
      .values({ ...base, status: "failed", error: (err as Error).message })
      .returning();
    return row;
  }
}
