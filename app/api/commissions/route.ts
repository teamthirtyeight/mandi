// Custom orders. Buyers ask for one (POST) and see theirs; sellers see the ones
// for their listings. Invoiced ones are checked with PayPal so "paid" shows up.
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";
import { refreshCommission, requestCommission } from "@/lib/commissions";

export const dynamic = "force-dynamic";

const Body = z.object({
  listingId: z.string().uuid(),
  request: z.string().trim().min(10, "Describe what you'd like made, in a sentence or two.").max(600),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser("buyer");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const c = await requestCommission({ ...parsed.data, buyerUserId: user.id });
    return NextResponse.json({ id: c.id, status: c.status });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const where =
      user.role === "buyer" ? eq(schema.commissions.buyerUserId, user.id) : eq(schema.commissions.sellerId, user.sellerId ?? "00000000-0000-0000-0000-000000000000");
    let rows = await db
      .select({ c: schema.commissions, title: schema.listings.title, image: schema.listings.images, seller: schema.sellers.name, buyer: schema.users.name })
      .from(schema.commissions)
      .innerJoin(schema.listings, eq(schema.listings.id, schema.commissions.listingId))
      .innerJoin(schema.sellers, eq(schema.sellers.id, schema.commissions.sellerId))
      .innerJoin(schema.users, eq(schema.users.id, schema.commissions.buyerUserId))
      .where(where)
      .orderBy(desc(schema.commissions.createdAt))
      .limit(50);
    const invoiced = rows.filter((r) => r.c.status === "INVOICED").slice(0, 3);
    if (invoiced.length) {
      await Promise.all(invoiced.map((r) => refreshCommission(r.c.id).catch((e) => console.error("[commissions] refresh", e))));
      rows = await db
        .select({ c: schema.commissions, title: schema.listings.title, image: schema.listings.images, seller: schema.sellers.name, buyer: schema.users.name })
        .from(schema.commissions)
        .innerJoin(schema.listings, eq(schema.listings.id, schema.commissions.listingId))
        .innerJoin(schema.sellers, eq(schema.sellers.id, schema.commissions.sellerId))
        .innerJoin(schema.users, eq(schema.users.id, schema.commissions.buyerUserId))
        .where(where)
        .orderBy(desc(schema.commissions.createdAt))
        .limit(50);
    }
    return NextResponse.json({
      commissions: rows.map((r) => ({
        id: r.c.id,
        listingId: r.c.listingId,
        title: r.title,
        image: r.image[0] ?? null,
        seller: r.seller,
        buyer: r.buyer,
        request: r.c.request,
        // The buyer sees the price once the artisan has approved it.
        price: user.role === "seller" || r.c.status !== "AWAITING_SELLER" ? r.c.priceMinor / 100 : null,
        readyInDays: r.c.readyInDays,
        agentNote: r.c.agentNote,
        status: r.c.status,
        invoiceId: r.c.invoiceId,
        invoiceUrl: r.c.invoiceUrl,
        createdAt: r.c.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
