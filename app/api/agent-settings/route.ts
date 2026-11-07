// The signed-in user's agent settings. Sellers also edit the profile fields
// their agent relies on (story, language, shipping, refund cap).
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";
import { BuyerAgentSettings, SellerAgentSettings } from "@/lib/agents/settings";
import { SELLER_LANGUAGES } from "@/lib/i18n/seller";
import { normalizeWhatsAppNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";

const SellerProfile = z.object({
  story: z.string().trim().min(10).max(600),
  language: z.enum(SELLER_LANGUAGES),
  // WhatsApp alerts: an international number (+91…) and the seller's opt-in.
  whatsappNumber: z
    .string()
    .trim()
    .max(24)
    .transform((v, ctx) => {
      if (!v) return null;
      const n = normalizeWhatsAppNumber(v);
      if (!n) ctx.addIssue({ code: "custom", message: "Enter the number with its country code, like +91 98765 43210" });
      return n;
    })
    .default(""),
  whatsappOptIn: z.boolean().default(false),
  shipByDays: z.number().int().min(1).max(3),
  transitDays: z.number().int().min(1).max(30),
  refundCap: z.number().min(0).max(1000),
});

export async function GET() {
  try {
    const user = await requireUser();
    if (user.role === "buyer") {
      const { agentStyle, maxSellers, acceptBundles, priority } = user;
      return NextResponse.json({ role: "buyer", name: user.name, settings: { agentStyle, maxSellers, acceptBundles, priority } });
    }
    const [s] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, user.sellerId!));
    return NextResponse.json({
      role: "seller",
      name: s.name,
      settings: {
        agentStyle: s.agentStyle,
        offerGiftWrap: s.offerGiftWrap,
        offerBundles: s.offerBundles,
        maxBundleDiscountPct: s.maxBundleDiscountPct,
        agentNote: s.agentNote,
      },
      profile: {
        story: s.story,
        language: s.language,
        shipByDays: s.shipByDays,
        transitDays: s.transitDays,
        refundCap: s.refundCapMinor / 100,
        whatsappNumber: s.whatsappNumber ?? "",
        whatsappOptIn: s.whatsappOptIn,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    if (user.role === "buyer") {
      const parsed = BuyerAgentSettings.safeParse(body?.settings);
      if (!parsed.success) return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
      await db.update(schema.users).set(parsed.data).where(eq(schema.users.id, user.id));
      return NextResponse.json({ ok: true });
    }
    const settings = SellerAgentSettings.safeParse(body?.settings);
    const profile = SellerProfile.safeParse(body?.profile);
    if (!settings.success || !profile.success) {
      const issue = (settings.error ?? profile.error)?.issues[0];
      return NextResponse.json({ error: issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid settings" }, { status: 400 });
    }
    const { refundCap, ...rest } = profile.data;
    if (rest.whatsappOptIn && !rest.whatsappNumber) {
      return NextResponse.json({ error: "Add your WhatsApp number to turn on WhatsApp alerts" }, { status: 400 });
    }
    await db
      .update(schema.sellers)
      .set({ ...settings.data, agentNote: settings.data.agentNote || null, ...rest, refundCapMinor: Math.round(refundCap * 100) })
      .where(eq(schema.sellers.id, user.sellerId!));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
