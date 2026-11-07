// The image card attached to a WhatsApp alert. Twilio downloads it from the
// signed link in the message (lib/notify.ts bannerUrl); anything unsigned is
// refused, so order details can't be browsed by guessing links.
//   ?k=held|captured|refund_pending|refunded|voided&id=<orderId>&x=<extra minor>&s=<sig>
//   ?k=welcome&id=<sellerId>&x=0&s=<sig>
import { NextResponse } from "next/server";
import { renderBannerCached, verifyBanner } from "@/lib/banner";
import { bannerData } from "@/lib/banner-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const kind = q.get("k") ?? "";
  const id = q.get("id") ?? "";
  const extra = q.get("x") ?? "0";
  if (!verifyBanner([kind, id, extra], q.get("s"))) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let png: Buffer | null;
  try {
    png = await renderBannerCached(`${kind}|${id}|${extra}`, () => bannerData(kind, id, Number(extra)));
  } catch (err) {
    console.error("[banner] render failed", err);
    return NextResponse.json({ error: "Couldn't draw the card" }, { status: 503 });
  }
  if (!png) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, immutable" },
  });
}
