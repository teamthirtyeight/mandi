// Adds the maker stories, craft photos and regional makers to an existing
// database WITHOUT wiping it (unlike lib/db/seed.ts). Safe to run more than
// once: existing makers get their story fields updated, missing makers and
// listings are added. Run on Render's shell:  npx tsx scripts/add-makers.ts
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db";
import { MAKER_ACCOUNTS, MAKERS, PRODUCT_PHOTOS, REGIONAL_LISTINGS, REGIONAL_SELLERS, makerFields } from "../lib/db/makers";

async function main() {
  let updated = 0;
  let addedSellers = 0;
  let addedListings = 0;

  // Stories for the original demo sellers, matched by name and city.
  for (const key of ["meera", "arjun", "fatima"] as const) {
    const m = MAKERS[key];
    const rows = await db
      .update(schema.sellers)
      .set(makerFields(key))
      .where(and(eq(schema.sellers.name, m.name), eq(schema.sellers.city, m.city)))
      .returning({ id: schema.sellers.id });
    updated += rows.length;
  }

  // Regional makers and their pieces, added once.
  for (const key of REGIONAL_SELLERS) {
    const acct = MAKER_ACCOUNTS[key];
    let [seller] = await db
      .select({ id: schema.sellers.id })
      .from(schema.sellers)
      .where(and(eq(schema.sellers.name, acct.name), eq(schema.sellers.city, acct.city)));
    if (seller) {
      await db.update(schema.sellers).set(makerFields(key)).where(eq(schema.sellers.id, seller.id));
      updated++;
    } else {
      [seller] = await db.insert(schema.sellers).values({ ...acct, ...makerFields(key) }).returning({ id: schema.sellers.id });
      addedSellers++;
    }
    for (const { maker, ...l } of REGIONAL_LISTINGS.filter((x) => x.maker === key)) {
      void maker;
      const [exists] = await db
        .select({ id: schema.listings.id })
        .from(schema.listings)
        .where(and(eq(schema.listings.sellerId, seller.id), eq(schema.listings.title, l.title)));
      if (!exists) {
        await db.insert(schema.listings).values({ ...l, sellerId: seller.id });
        addedListings++;
      }
    }
  }

  // Product photos, only for demo listings that have no photo of their own
  // (a seller's uploads are never replaced).
  let photos = 0;
  for (const [title, photo] of Object.entries(PRODUCT_PHOTOS)) {
    const rows = await db
      .update(schema.listings)
      .set({ images: [photo.url], imageCredit: photo.credit, imageSource: photo.source })
      .where(and(eq(schema.listings.title, title), sql`(${schema.listings.images} = '[]'::jsonb OR ${schema.listings.imageCredit} IS NOT NULL)`))
      .returning({ id: schema.listings.id });
    photos += rows.length;
  }

  console.log(`Makers: ${updated} updated, ${addedSellers} added; ${addedListings} listings added; ${photos} product photos set.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
