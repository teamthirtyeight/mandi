// In-app notifications for buyers and sellers, written at each step of an
// order. Sellers get them in their language (Hindi for Meera) with rupees, and
// on WhatsApp too if they've opted in.
// The bell in the nav shows them and, with permission, the browser raises a
// system notification. Failures here never block the money flow.
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { gbpInr, inr } from "@/lib/fx";
import { SELLER_STRINGS, sellerLanguage, type SellerLanguage } from "@/lib/i18n/seller";
import { sendWhatsApp } from "@/lib/whatsapp";
import { signBanner, type BannerData } from "@/lib/banner";

export type OrderEvent = "held" | "captured" | "refunded" | "refund_pending" | "voided" | "paid_out" | "refund_declined";

const gbp = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);

async function parties(orderId: string) {
  const [row] = await db
    .select({
      order: schema.orders,
      title: schema.listings.title,
      images: schema.listings.images,
      sellerId: schema.sellers.id,
      sellerName: schema.sellers.name,
      language: schema.sellers.language,
      whatsappNumber: schema.sellers.whatsappNumber,
      whatsappOptIn: schema.sellers.whatsappOptIn,
      shipByDays: schema.sellers.shipByDays,
      buyerUserId: schema.mandates.buyerUserId,
    })
    .from(schema.orders)
    .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
    .innerJoin(schema.listings, eq(schema.listings.id, schema.negotiations.listingId))
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .innerJoin(schema.mandates, eq(schema.mandates.id, schema.negotiations.mandateId))
    .where(eq(schema.orders.id, orderId));
  if (!row) return null;
  const sellerUsers = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.sellerId, row.sellerId));
  return { ...row, sellerUserIds: sellerUsers.map((u) => u.id) };
}

function sellerText(e: OrderEvent, lang: SellerLanguage, title: string, amountMinor: number, extraMinor: number, shipByDays: number, rate: number) {
  const t = SELLER_STRINGS[lang];
  const money = `${inr(amountMinor / 100, rate)} (${gbp(amountMinor)})`;
  const extra = `${inr(extraMinor / 100, rate)} (${gbp(extraMinor)})`;
  switch (e) {
    case "held":
      return { title: t.soldTitle(money), body: `${title}: ${t.shipWithin(shipByDays)}` };
    case "captured":
      return { title: t.paid(money), body: title };
    case "refund_pending":
      return { title: t.refundTitle(extra), body: `${title}: ${t.complained}` };
    case "refunded":
      return { title: t.refunded(extra), body: title };
    case "voided":
      return { title: t.voidedTitle, body: `${title}: ${t.voidedBody}` };
    case "paid_out":
      return { title: t.paidOut(extra), body: `${title}: ${t.paidOutBody}` };
    case "refund_declined":
      return null; // the seller chose this themselves
  }
}

/** The image card for a seller alert (lib/banner.ts), from the same facts as its text. */
export async function sellerBanner(orderId: string, event: OrderEvent, extraMinor = 0): Promise<BannerData | null> {
  const p = await parties(orderId);
  if (!p) return null;
  const { rate } = await gbpInr();
  const lang = sellerLanguage(p.language);
  const t = SELLER_STRINGS[lang];
  const rupees = (minor: number) => inr(minor / 100, rate);
  const base = { lang, listingTitle: p.title, image: p.images[0] ?? null, sellerName: p.sellerName };
  switch (event) {
    case "held":
      return { ...base, tone: "agreed", chip: t.toShip, headline: t.soldTitle(rupees(p.order.amountMinor)), sub: gbp(p.order.amountMinor), body: t.shipWithin(p.shipByDays) };
    case "captured":
      return { ...base, tone: "safe", chip: t.done, headline: t.paid(rupees(p.order.amountMinor)), sub: gbp(p.order.amountMinor), body: null };
    case "refund_pending":
      return { ...base, tone: "bad", chip: t.problem, headline: t.refundTitle(rupees(extraMinor)), sub: gbp(extraMinor), body: t.complained };
    case "refunded":
      return { ...base, tone: "progress", chip: null, headline: t.refunded(rupees(extraMinor)), sub: gbp(extraMinor), body: null };
    case "voided":
      return { ...base, tone: "plain", chip: null, headline: t.voidedTitle, sub: null, body: t.voidedBody };
    case "paid_out":
      return { ...base, tone: "safe", chip: t.done, headline: t.paidOut(rupees(extraMinor)), sub: gbp(extraMinor), body: t.paidOutBody };
    case "refund_declined":
      return null;
  }
}

/** Signed link Twilio downloads the card from; null when Mandi isn't publicly reachable. */
export function bannerUrl(kind: string, id: string, extraMinor = 0): string | null {
  const base = appUrl();
  if (!base.startsWith("https://")) return null; // Twilio can't download from localhost
  const parts = [kind, id, String(extraMinor)];
  const q = new URLSearchParams({ k: kind, id, x: String(extraMinor), s: signBanner(parts) });
  return `${base}/api/whatsapp/banner?${q}`;
}

/** Public address for links in WhatsApp messages. */
export function appUrl(): string {
  return (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function buyerText(e: OrderEvent, title: string, amountMinor: number, extraMinor: number, tracking: string | null) {
  switch (e) {
    case "held":
      return { title: `${gbp(amountMinor)} held`, body: `${title}. Nothing is paid until the seller ships.` };
    case "captured":
      return { title: "Shipped!", body: `${title}${tracking ? `, tracking ${tracking}` : ""}. Your payment went through.` };
    case "refunded":
      return { title: `Refund: ${gbp(extraMinor)}`, body: `${title}. It's on its way back to your PayPal account.` };
    case "voided":
      return { title: "Order cancelled", body: `${title}: the seller couldn't ship in time. You weren't charged.` };
    case "refund_declined":
      return {
        title: "The seller didn't approve a refund",
        body: `${title}. If you're not happy, you can still open a case with PayPal: your purchase is covered by PayPal Buyer Protection.`,
      };
    case "refund_pending":
    case "paid_out":
      return null; // the buyer already sees "waiting for the seller"; payouts are between Mandi and the seller
  }
}

/** Notifies both sides of an order event. extraMinor = refund amount. */
export async function notifyOrder(orderId: string, event: OrderEvent, extraMinor = 0): Promise<void> {
  try {
    const p = await parties(orderId);
    if (!p) return; // test orders have no buyer or seller
    const link = `/order/${orderId}`;
    const rows: (typeof schema.notifications.$inferInsert)[] = [];
    const { rate } = await gbpInr();
    const lang = sellerLanguage(p.language);
    const s = sellerText(event, lang, p.title, p.order.amountMinor, extraMinor, p.shipByDays, rate);
    const sellerLink = event === "held" ? "/seller" : link;
    if (s) for (const userId of p.sellerUserIds) rows.push({ userId, ...s, link: sellerLink });
    // The seller's agent also messages them on WhatsApp, if they opted in.
    // Not awaited: a slow or failed message never holds up the money flow.
    if (s && p.whatsappOptIn && p.whatsappNumber) {
      const body = `*${s.title}*\n${s.body}\n\n${SELLER_STRINGS[lang].open}: ${appUrl()}${sellerLink}`;
      const to = p.whatsappNumber;
      void (async () => {
        const { preparedBannerUrl } = await import("@/lib/banner-data"); // lazy: avoids an import cycle
        const mediaUrl = await preparedBannerUrl(event, orderId, extraMinor);
        await sendWhatsApp({ sellerId: p.sellerId, orderId, to, body, mediaUrl });
      })().catch((err) => console.error("[notify] whatsapp failed", err));
    }
    const b = buyerText(event, p.title, p.order.amountMinor, extraMinor, p.order.trackingNumber);
    if (b && p.buyerUserId) rows.push({ userId: p.buyerUserId, ...b, link });
    if (rows.length) await db.insert(schema.notifications).values(rows);
  } catch (err) {
    console.error("[notify] failed", err);
  }
}

export async function notifyUser(userId: string | null, title: string, body: string, link: string): Promise<void> {
  if (!userId) return;
  try {
    await db.insert(schema.notifications).values({ userId, title, body, link });
  } catch (err) {
    console.error("[notify] failed", err);
  }
}
