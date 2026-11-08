// What goes on each WhatsApp card, and drawing it ahead of sending.
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { renderBannerCached, type BannerData } from "@/lib/banner";
import { bannerUrl, sellerBanner, type OrderEvent } from "@/lib/notify";
import { SELLER_STRINGS, sellerLanguage } from "@/lib/i18n/seller";

const EVENTS = new Set<string>(["held", "captured", "refund_pending", "refunded", "voided"]);

export async function bannerData(kind: string, id: string, extra: number): Promise<BannerData | null> {
  if (kind === "welcome") return welcomeBanner(id);
  return EVENTS.has(kind) ? sellerBanner(id, kind as OrderEvent, extra) : null;
}

async function welcomeBanner(sellerId: string): Promise<BannerData | null> {
  const [seller] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, sellerId));
  if (!seller) return null;
  const lang = sellerLanguage(seller.language);
  const t = SELLER_STRINGS[lang];
  return { lang, tone: "safe", chip: null, headline: t.title, sub: null, body: t.welcome, listingTitle: null, image: null, sellerName: seller.name };
}

/**
 * Draws the card now and returns its public link, or null (send text only) if
 * Mandix isn't publicly reachable or the card can't be drawn. Twilio fails the
 * whole message when its image can't be fetched, so a card is only attached
 * once it exists.
 */
export async function preparedBannerUrl(kind: string, id: string, extra = 0): Promise<string | null> {
  const url = bannerUrl(kind, id, extra);
  if (!url) return null;
  try {
    const png = await renderBannerCached(`${kind}|${id}|${extra}`, () => bannerData(kind, id, extra));
    return png ? url : null;
  } catch (err) {
    console.error("[banner] couldn't draw the card; sending text only", err);
    return null;
  }
}
