// A seller's own listing: read it (floor included) and edit it. Changes apply
// to new negotiations; deal approval re-checks the floor as it is now.
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { errorResponse, UUID } from "@/lib/api/errors";
import { AuthError, requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

async function own(id: string) {
  const user = await requireUser("seller");
  const [l] = await db
    .select()
    .from(schema.listings)
    .where(and(eq(schema.listings.id, id), eq(schema.listings.sellerId, user.sellerId!)));
  if (!l) throw new AuthError("Not your listing", 403);
  return l;
}

const view = (l: typeof schema.listings.$inferSelect) => ({
  id: l.id,
  title: l.title,
  description: l.description,
  category: l.category,
  materials: l.materials,
  listPrice: l.listPriceMinor / 100,
  floorPrice: l.floorPriceMinor / 100,
  refundCap: l.refundCapMinor != null ? l.refundCapMinor / 100 : null,
  stock: l.stock,
  status: l.status,
  images: l.images,
  paypalProductId: l.paypalProductId,
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid listing id" }, { status: 400 });
  try {
    return NextResponse.json({ listing: view(await own(id)) });
  } catch (err) {
    return errorResponse(err);
  }
}

const Patch = z
  .object({
    title: z.string().trim().min(3).max(100),
    description: z.string().trim().min(10).max(600),
    materials: z.string().trim().min(2).max(120),
    listPrice: z.number().positive().max(10000),
    floorPrice: z.number().positive(),
    refundCap: z.number().min(0).max(10000).nullable(),
    stock: z.number().int().min(0).max(999),
    status: z.enum(["active", "paused"]),
  })
  .refine((b) => b.floorPrice <= b.listPrice, { message: "Floor must be at or below the list price" });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid listing id" }, { status: 400 });
  try {
    await own(id);
    const parsed = Patch.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid listing" }, { status: 400 });
    const b = parsed.data;
    const [updated] = await db
      .update(schema.listings)
      .set({
        title: b.title,
        description: b.description,
        materials: b.materials,
        listPriceMinor: Math.round(b.listPrice * 100),
        floorPriceMinor: Math.round(b.floorPrice * 100),
        refundCapMinor: b.refundCap != null ? Math.round(b.refundCap * 100) : null,
        stock: b.stock,
        // Restocking a sold-out item puts it back on sale.
        status: b.status === "paused" ? "paused" : b.stock > 0 ? "active" : "sold",
      })
      .where(eq(schema.listings.id, id))
      .returning();
    return NextResponse.json({ listing: view(updated) });
  } catch (err) {
    return errorResponse(err);
  }
}
