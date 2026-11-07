// Public listing search (no private fields). ?q= filters by keywords.
import { NextResponse } from "next/server";
import { listCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  const items = await listCatalog(q?.slice(0, 80));
  // Card view: first photo only.
  return NextResponse.json({ items: items.map(({ images, ...i }) => ({ ...i, image: images[0] ?? null, photos: images.length })) });
}
