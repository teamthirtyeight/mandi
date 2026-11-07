// Twilio calls this when a seller writes to Mandi's WhatsApp number.
// Set it as the "When a message comes in" URL (POST) in Twilio. Requests are
// checked against Twilio's signature, answered at once (Twilio waits only 15 s),
// and handled in the background; the reply goes out as a normal message.
import { appUrl } from "@/lib/notify";
import { handleInbound } from "@/lib/whatsapp-inbound";
import { validTwilioSignature } from "@/lib/twilio-signature";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;

  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return new Response("WhatsApp is not configured", { status: 503 });
  const url = `${appUrl()}/api/whatsapp/inbound`;
  if (!validTwilioSignature(token, req.headers.get("x-twilio-signature"), url, params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  void handleInbound({
    from: params.From ?? "",
    body: params.Body ?? "",
    mediaUrl: Number(params.NumMedia ?? 0) > 0 ? params.MediaUrl0 : null,
    mediaType: Number(params.NumMedia ?? 0) > 0 ? params.MediaContentType0 : null,
  }).catch((err) => console.error("[whatsapp-in] crashed", err));

  return new Response(EMPTY_TWIML, { headers: { "Content-Type": "text/xml" } });
}
