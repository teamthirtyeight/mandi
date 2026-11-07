// Two-way WhatsApp: a seller runs their shop by replying to Mandi's agent.
//
//   📷 a photo of the shipping receipt  → the order ships, PayPal captures, the seller is paid out
//   a typed tracking number             → the same
//   yes / no (in any seller language)   → answers a waiting refund or custom-order request
//   "status" / "हिसाब"                  → what's to ship, held and paid
//   "language" / "भाषा"                 → pick a language by number
//
// The model only reads the receipt photo and, for free text, picks one of
// those intents. Every action goes through the same order service as the web
// app, with the same checks; nothing here moves money on the model's say-so.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { structured } from "@/lib/ai/claude";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/lib/guardrails";
import { gbpInr, inr } from "@/lib/fx";
import { LANGUAGE_INFO, SELLER_LANGUAGES, sellerLanguage, type SellerLanguage } from "@/lib/i18n/seller";
import { findTrackingNumber, quickIntent, WHATSAPP_REPLIES } from "@/lib/i18n/whatsapp";
import { declineRefund, OrderError, refundOrder, shipOrder } from "@/lib/orders/service";
import { normalizeWhatsAppNumber, sendWhatsApp } from "@/lib/whatsapp";

export interface InboundMessage {
  from: string;
  body: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
}

type Seller = typeof schema.sellers.$inferSelect;

const gbp = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);

/** Handles one message and sends the reply. Returns the reply text (null if the sender isn't a seller). */
export async function handleInbound(msg: InboundMessage): Promise<string | null> {
  const number = normalizeWhatsAppNumber(msg.from.replace(/^whatsapp:/, ""));
  if (!number) return null;
  const [seller] = await db.select().from(schema.sellers).where(eq(schema.sellers.whatsappNumber, number));
  if (!seller) return null;

  await db.insert(schema.whatsappMessages).values({
    sellerId: seller.id,
    to: number,
    body: msg.body.slice(0, 2000),
    mediaUrl: msg.mediaUrl ?? null,
    status: "received",
    direction: "in",
  });

  let reply: string;
  try {
    reply = await decide(seller, msg);
  } catch (err) {
    console.error("[whatsapp-in] failed", err);
    const t = WHATSAPP_REPLIES[sellerLanguage(seller.language)];
    reply = err instanceof OrderError ? `${err.message}\n\n${t.help}` : t.help;
  }
  // Replying also counts as the seller opting in to messages on this number.
  if (!seller.whatsappOptIn) await db.update(schema.sellers).set({ whatsappOptIn: true }).where(eq(schema.sellers.id, seller.id));
  await sendWhatsApp({ sellerId: seller.id, to: number, body: reply });
  return reply;
}

async function decide(seller: Seller, msg: InboundMessage): Promise<string> {
  let lang = sellerLanguage(seller.language);
  const t = () => WHATSAPP_REPLIES[lang];
  const text = msg.body.trim();

  // Answer to the language menu: a number from the list.
  if (seller.whatsappAwaiting === "language") {
    await db.update(schema.sellers).set({ whatsappAwaiting: null }).where(eq(schema.sellers.id, seller.id));
    const n = Number.parseInt(text.replace(/[^\d]/g, ""), 10);
    if (n >= 1 && n <= SELLER_LANGUAGES.length) {
      lang = SELLER_LANGUAGES[n - 1];
      await db.update(schema.sellers).set({ language: lang }).where(eq(schema.sellers.id, seller.id));
      return t().languageSet;
    }
  }

  const image = msg.mediaUrl && (msg.mediaType ?? "").startsWith("image/");
  let intent: Intent | null = quickIntent(text);
  let tracking: string | null = null;
  if (image) intent = "ship";
  else if (!intent && (tracking = findTrackingNumber(text))) intent = "ship";
  else if (!intent && text) {
    const guess = await classify(text);
    intent = guess?.intent ?? "help";
    tracking = guess?.trackingNumber ?? null;
  }

  switch (intent) {
    case "ship":
      return ship(seller, lang, image ? msg : null, tracking);
    case "yes":
    case "no":
      return answer(seller, lang, intent);
    case "status":
      return status(seller, lang);
    case "language":
      await db.update(schema.sellers).set({ whatsappAwaiting: "language" }).where(eq(schema.sellers.id, seller.id));
      return `${t().languageMenu}\n${SELLER_LANGUAGES.map((c, i) => `${i + 1}. ${LANGUAGE_INFO[c].native}`).join("\n")}`;
    default:
      return t().help;
  }
}

type Intent = "yes" | "no" | "status" | "language" | "help" | "ship";

/** The seller's orders, newest first, with their listing titles. */
async function sellerOrders(sellerId: string) {
  return db
    .select({ o: schema.orders, title: schema.listings.title })
    .from(schema.orders)
    .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .where(eq(schema.listings.sellerId, sellerId))
    .orderBy(asc(schema.orders.authorizedAt));
}

async function ship(seller: Seller, lang: SellerLanguage, photo: InboundMessage | null, typed: string | null): Promise<string> {
  const t = WHATSAPP_REPLIES[lang];
  const toShip = (await sellerOrders(seller.id)).filter((r) => r.o.status === "AUTHORIZED");
  if (toShip.length === 0) return t.nothingToShip;

  let tracking = typed;
  let carrier: string | null = null;
  if (photo) {
    const read = await readReceipt(photo);
    tracking = read?.trackingNumber ?? null;
    carrier = read?.carrier ?? null;
  }
  if (!tracking) return t.cantRead;
  carrier ??= /^[A-Z]{2}\d{9}IN$/.test(tracking) ? "India Post" : "Other";

  // The oldest order waiting is the one this receipt is for.
  const next = toShip[0];
  await shipOrder(next.o.id, { carrier, trackingNumber: tracking });
  return t.shipped(next.title, tracking);
}

async function answer(seller: Seller, lang: SellerLanguage, yes: "yes" | "no"): Promise<string> {
  const t = WHATSAPP_REPLIES[lang];
  // A refund the seller's agent couldn't approve on its own comes first.
  const orders = await sellerOrders(seller.id);
  const refund = orders.find((r) => r.o.pendingRefundMinor != null && r.o.status === "CAPTURED");
  if (refund) {
    const amount = refund.o.pendingRefundMinor!;
    if (yes === "no") {
      await declineRefund(refund.o.id);
      return t.refundKept;
    }
    await refundOrder(refund.o.id, { amountMinor: amount, requestKey: `wa-${refund.o.id}-${amount}`, approvedBy: "seller" });
    const { rate } = await gbpInr();
    return t.refundDone(`${inr(amount / 100, rate)} (${gbp(amount)})`);
  }

  const [commission] = await db
    .select()
    .from(schema.commissions)
    .where(and(eq(schema.commissions.sellerId, seller.id), eq(schema.commissions.status, "AWAITING_SELLER")))
    .orderBy(asc(schema.commissions.createdAt))
    .limit(1);
  if (commission) {
    const { approveCommission, declineCommission } = await import("@/lib/commissions");
    if (yes === "no") {
      await declineCommission(commission.id);
      return t.commissionDeclined;
    }
    await approveCommission(commission.id);
    const { rate } = await gbpInr();
    return t.commissionSent(`${inr(commission.priceMinor / 100, rate)} (${gbp(commission.priceMinor)})`);
  }
  return t.nothingPending;
}

async function status(seller: Seller, lang: SellerLanguage): Promise<string> {
  const orders = await sellerOrders(seller.id);
  const { rate } = await gbpInr();
  const toShip = orders.filter((r) => r.o.status === "AUTHORIZED");
  const held = toShip.reduce((a, r) => a + r.o.amountMinor, 0);
  const paid = orders.reduce((a, r) => a + (r.o.payoutStatus && r.o.payoutStatus !== "FAILED" ? (r.o.payoutMinor ?? 0) : 0), 0);
  return WHATSAPP_REPLIES[lang].status(toShip.length, inr(held / 100, rate), inr(paid / 100, rate));
}

// ---- Model calls: read a receipt photo, classify free text ----

const Receipt = z.object({
  trackingNumber: z.string().nullable().describe("The consignment or tracking number exactly as printed, without spaces; null if none is readable."),
  carrier: z.string().nullable().describe("The postal service or courier, e.g. India Post, DHL, Blue Dart; null if unclear."),
});

async function readReceipt(msg: InboundMessage): Promise<z.infer<typeof Receipt> | null> {
  const image = await downloadMedia(msg.mediaUrl!);
  if (!image) return null;
  const out = await structured({
    label: "whatsapp-receipt",
    schema: Receipt,
    system:
      "You read photos of shipping receipts from Indian post offices and couriers. Return the tracking (consignment) number and the carrier. Read only what is printed; never guess a number.",
    content: [
      { type: "image", source: { type: "base64", media_type: image.type, data: image.data } },
      { type: "text", text: "What is the tracking number on this receipt?" },
    ],
  });
  if (!out?.trackingNumber) return out;
  const cleaned = out.trackingNumber.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length >= 8 && cleaned.length <= 30 ? { ...out, trackingNumber: cleaned } : { ...out, trackingNumber: null };
}

async function downloadMedia(url: string): Promise<{ type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } | null> {
  // Only Twilio's own media host, with our account's credentials.
  if (!/^https:\/\/api\.twilio\.com\//.test(url)) return null;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const type = (res.headers.get("content-type") ?? "").split(";")[0];
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) return null;
  return { type: type as "image/jpeg", data: bytes.toString("base64") };
}

const Classified = z.object({
  intent: z.enum(["yes", "no", "status", "language", "help", "ship"]),
  trackingNumber: z.string().nullable(),
});

async function classify(text: string) {
  return structured({
    label: "whatsapp-intent",
    schema: Classified,
    system: `You sort WhatsApp replies from Indian artisans who sell on Mandi. The reply may be in any Indian language or English, in any script.
yes: agrees or approves (e.g. "ठीक है, कर दो"). no: refuses. status: asks about sales or money. language: wants another language. ship: says they shipped, or gives a tracking number (put it in trackingNumber, else null). help: anything else.
${UNTRUSTED_DATA_RULE}`,
    content: wrapUntrusted("seller_message", text.slice(0, 1000)),
  });
}
