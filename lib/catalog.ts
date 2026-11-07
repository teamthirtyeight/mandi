// Public catalog: what any visitor (or buyer agent) may see about a listing.
// Never includes the floor, refund cap or anything else private to the seller.
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const publicFields = {
  id: schema.listings.id,
  title: schema.listings.title,
  description: schema.listings.description,
  category: schema.listings.category,
  materials: schema.listings.materials,
  listPriceMinor: schema.listings.listPriceMinor,
  currency: schema.listings.currency,
  images: schema.listings.images,
  stock: schema.listings.stock,
  sellerName: schema.sellers.name,
  sellerCity: schema.sellers.city,
  sellerStory: schema.sellers.story,
  shipByDays: schema.sellers.shipByDays,
  transitDays: schema.sellers.transitDays,
};

export async function listCatalog(q?: string) {
  const terms = (q ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const match = terms.length
    ? sql`to_tsvector('english', ${schema.listings.title} || ' ' || ${schema.listings.description} || ' ' || ${schema.listings.category}) @@ to_tsquery('english', ${terms.join(" | ")})`
    : sql`true`;
  return db
    .select(publicFields)
    .from(schema.listings)
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(and(eq(schema.listings.status, "active"), gt(schema.listings.stock, 0), match))
    .orderBy(desc(schema.listings.createdAt))
    .limit(60);
}

export async function getCatalogItem(id: string) {
  const [row] = await db
    .select({ ...publicFields, status: schema.listings.status })
    .from(schema.listings)
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(eq(schema.listings.id, id));
  return row ?? null;
}
