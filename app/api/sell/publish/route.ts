// Seller onboarding step 2: save the listing with the seller's private floor,
// then create the PayPal catalog product through the Agent Toolkit.
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createCatalogProduct } from "@/lib/paypal/toolkit";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";

const Body = z
  .object({
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().min(10).max(600),
    category: z.string().trim().min(2).max(40),
    materials: z.string().trim().min(2).max(120),
    images: z.array(z.string().startsWith("data:image/").max(7_000_000)).max(3),
    listPrice: z.number().positive().max(10000),
    floorPrice: z.number().positive(),
    refundCap: z.number().min(0).max(10000).optional(),
    comps: z.unknown().optional(),
  })
  .refine((b) => b.floorPrice <= b.listPrice, { message: "Floor must be at or below the list price" })
  .refine((b) => b.refundCap == null || b.refundCap <= b.listPrice, { message: "Refund cap can't exceed the list price" });

export async function POST(req: Request) {
  let sellerId: string;
  try {
    sellerId = (await requireUser("seller")).sellerId!;
  } catch (err) {
    return errorResponse(err);
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid listing" }, { status: 400 });
  }
  const b = parsed.data;

  const [listing] = await db
    .insert(schema.listings)
    .values({
      sellerId,
      title: b.title,
      description: b.description,
      category: b.category,
      materials: b.materials,
      images: b.images,
      listPriceMinor: Math.round(b.listPrice * 100),
      floorPriceMinor: Math.round(b.floorPrice * 100),
      refundCapMinor: b.refundCap != null ? Math.round(b.refundCap * 100) : null,
      currency: "GBP",
      compsJson: b.comps ?? null,
    })
    .returning({ id: schema.listings.id, title: schema.listings.title });

  const paypalProductId = await createCatalogProduct({ id: listing.id, title: b.title, description: b.description });
  if (paypalProductId) {
    await db.update(schema.listings).set({ paypalProductId }).where(eq(schema.listings.id, listing.id));
  }

  return NextResponse.json({ id: listing.id, title: listing.title, paypalProductId });
}
