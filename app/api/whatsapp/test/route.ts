// WhatsApp for the signed-in seller: GET lists their recent messages and
// whether real sending is on; POST sends a test message in their language.
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";
import { allow, MINUTE } from "@/lib/auth/ratelimit";
import { SELLER_STRINGS, sellerLanguage } from "@/lib/i18n/seller";
import { sendWhatsApp, whatsappLive } from "@/lib/whatsapp";
import { appUrl } from "@/lib/notify";
import { preparedBannerUrl } from "@/lib/banner-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser("seller");
    const messages = await db
      .select()
      .from(schema.whatsappMessages)
      .where(eq(schema.whatsappMessages.sellerId, user.sellerId!))
      .orderBy(desc(schema.whatsappMessages.createdAt))
      .limit(10);
    return NextResponse.json({ live: whatsappLive(), messages });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST() {
  try {
    const user = await requireUser("seller");
    if (!allow(`whatsapp-test:${user.id}`, 5, 10 * MINUTE)) {
      return NextResponse.json({ error: "That's a lot of test messages. Try again in a few minutes." }, { status: 429 });
    }
    const [seller] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, user.sellerId!));
    if (!seller.whatsappNumber) {
      return NextResponse.json({ error: "Save your WhatsApp number first" }, { status: 400 });
    }
    const t = SELLER_STRINGS[sellerLanguage(seller.language)];
    const message = await sendWhatsApp({
      sellerId: seller.id,
      to: seller.whatsappNumber,
      body: `*Mandix*\n${t.welcome}\n\n${t.open}: ${appUrl()}/seller`,
      mediaUrl: await preparedBannerUrl("welcome", seller.id),
    });
    return NextResponse.json({ message }, { status: message.status === "failed" ? 502 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
