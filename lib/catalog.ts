// Public catalog: what any visitor (or buyer agent) may see about a listing.
// Never includes the floor, refund cap or anything else private to the seller.
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
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
  dimensions: schema.listings.dimensions,
  care: schema.listings.care,
  sellerRegion: schema.sellers.region,
  sellerCraft: schema.sellers.craft,
  imageCredit: schema.listings.imageCredit,
  imageSource: schema.listings.imageSource,
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

// The maker behind a listing, for "Meet the maker" on the product page.
const makerFields = {
  sellerId: schema.sellers.id,
  sellerQuote: schema.sellers.quote,
  sellerPhotoUrl: schema.sellers.photoUrl,
  sellerPhotoCredit: schema.sellers.photoCredit,
  sellerPhotoSource: schema.sellers.photoSource,
};

export async function getCatalogItem(id: string) {
  const [row] = await db
    .select({ ...publicFields, ...makerFields, status: schema.listings.status })
    .from(schema.listings)
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.listings.sellerId))
    .where(eq(schema.listings.id, id));
  if (!row) return null;
  // A few more pieces by the same maker that are still for sale.
  const more = await db
    .select({ id: schema.listings.id, title: schema.listings.title, listPriceMinor: schema.listings.listPriceMinor, currency: schema.listings.currency, images: schema.listings.images })
    .from(schema.listings)
    .where(and(eq(schema.listings.sellerId, row.sellerId), ne(schema.listings.id, id), eq(schema.listings.status, "active"), gt(schema.listings.stock, 0)))
    .orderBy(desc(schema.listings.createdAt))
    .limit(3);
  return { ...row, more: more.map(({ images, ...m }) => ({ ...m, image: images[0] ?? null })) };
}
