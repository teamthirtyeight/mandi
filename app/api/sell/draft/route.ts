// Seller onboarding step 1: photos + voice note (or typed notes) → listing
// draft and a suggested price range from Channel3 comparables. Nothing is saved.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { UUID } from "@/lib/api/errors";
import { generateListing, type PhotoInput } from "@/lib/agents/listing";
import { transcribe } from "@/lib/ai/transcribe";
import { getComps } from "@/lib/channel3/comps";

const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });

  const sellerId = String(form.get("sellerId") ?? "");
  if (!UUID.test(sellerId)) return NextResponse.json({ error: "Pick a seller" }, { status: 400 });
  const [seller] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, sellerId));
  if (!seller) return NextResponse.json({ error: "Seller not found" }, { status: 404 });

  const photoFiles = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (photoFiles.length === 0) return NextResponse.json({ error: "Add at least one photo" }, { status: 400 });
  if (photoFiles.length > MAX_PHOTOS) return NextResponse.json({ error: `Up to ${MAX_PHOTOS} photos` }, { status: 400 });

  const photos: PhotoInput[] = [];
  for (const f of photoFiles) {
    if (!IMAGE_TYPES.has(f.type) || f.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "Photos must be JPEG, PNG, WebP or GIF under 5 MB" }, { status: 400 });
    }
    photos.push({ mediaType: f.type as PhotoInput["mediaType"], base64: Buffer.from(await f.arrayBuffer()).toString("base64") });
  }

  const audio = form.get("audio");
  let transcript: string | null = null;
  if (audio instanceof File && audio.size > 0) {
    if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "Voice note must be under 10 MB" }, { status: 400 });
    transcript = await transcribe(audio);
  }
  const notes = String(form.get("notes") ?? "").slice(0, 2000);

  const listing = await generateListing({ photos, transcript, notes, sellerName: seller.name, sellerStory: seller.story });
  if (!listing) {
    return NextResponse.json(
      { error: "Couldn't write a listing. Add a sentence about the item in the notes.", transcript },
      { status: 422 },
    );
  }

  const comps =
    (await getComps({ query: listing.search_query, country: "GB" })) ??
    (await getComps({ base64Image: photos[0].base64, country: "GB" }));

  return NextResponse.json({
    transcript,
    listing,
    images: photos.map((p) => `data:${p.mediaType};base64,${p.base64}`),
    comps,
    suggested: comps
      ? { listPrice: comps.highMinor / 100, floorLow: comps.lowMinor / 100, floorHigh: comps.medianMinor / 100 }
      : null,
  });
}
