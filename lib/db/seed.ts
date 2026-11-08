// Demo seed: 8 makers from across India, 14 listings, 1 mandate-ready buyer,
// 2 historical orders. Maker stories and photo credits are in ./makers.ts.
// The three scarf listings are tuned so every run shows three outcomes against
// Sarah's £90 ceiling: Meera agrees, Arjun walks away (floor above ceiling),
// Fatima's negotiation pushes the buyer into the ceiling clamp.
import "dotenv/config";
import { db, schema } from "./index";
import { sql } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { DEFAULT_DEMO_PASSWORD, DEMO_ACCOUNTS } from "../auth/demo";
import { MAKER_ACCOUNTS, MAKERS, PRODUCT_COPY, PRODUCT_PHOTOS, REGIONAL_LISTINGS, REGIONAL_SELLERS, makerFields } from "./makers";

const gbp = (pounds: number) => Math.round(pounds * 100);

async function main() {
  await db.execute(sql`
    TRUNCATE paypal_events, orders, negotiation_turns, negotiations,
             mandates, listings, notifications, password_resets, users, sellers RESTART IDENTITY CASCADE
  `);

  const [meera, arjun, fatima] = await db
    .insert(schema.sellers)
    .values([
      {
        name: "Meera",
        city: "Varanasi",
        country: "IN",
        ...makerFields("meera"),
        paypalMerchantEmail: process.env.SELLER_MEERA_EMAIL ?? "meera@example.com",
        language: "hi",
        shipByDays: 2,
        transitDays: 6,
      },
      {
        name: "Arjun",
        city: "Jaipur",
        country: "IN",
        ...makerFields("arjun"),
        paypalMerchantEmail: process.env.SELLER_ARJUN_EMAIL ?? "arjun@example.com",
        shipByDays: 3,
        transitDays: 7,
      },
      {
        name: "Fatima",
        city: "Srinagar",
        country: "IN",
        ...makerFields("fatima"),
        paypalMerchantEmail: process.env.SELLER_FATIMA_EMAIL ?? "fatima@example.com",
        shipByDays: 3,
        transitDays: 8,
      },
    ])
    .returning();

  const listings = await db.insert(schema.listings).values([
    {
      sellerId: meera.id,
      title: "Handwoven Banarasi silk scarf, rose and gold",
      description: "Pure mulberry silk with a zari border, woven on a pit loom.",
      category: "scarf",
      stock: 10, // demo pieces: rehearsals shouldn't sell them out
      materials: "mulberry silk, zari",
      listPriceMinor: gbp(95),
      floorPriceMinor: gbp(68),
    },
    {
      sellerId: meera.id,
      title: "Banarasi silk stole, peacock blue",
      description: "Lightweight silk stole with a small butti pattern.",
      category: "scarf",
      stock: 10, // demo pieces: rehearsals shouldn't sell them out
      materials: "mulberry silk",
      listPriceMinor: gbp(80),
      floorPriceMinor: gbp(60),
    },
    {
      sellerId: meera.id,
      title: "Handwoven silk cushion cover",
      description: "Brocade cushion cover, 40 x 40 cm.",
      category: "home",
      materials: "silk brocade",
      listPriceMinor: gbp(45),
      floorPriceMinor: gbp(32),
    },
    {
      sellerId: arjun.id,
      title: "Indigo block-printed silk scarf",
      description: "Hand block-printed with natural indigo on silk crepe.",
      category: "scarf",
      stock: 10, // demo pieces: rehearsals shouldn't sell them out
      materials: "silk crepe, natural indigo",
      listPriceMinor: gbp(120),
      floorPriceMinor: gbp(98),
    },
    {
      sellerId: arjun.id,
      title: "Block-printed cotton tablecloth",
      description: "Six-seater tablecloth, madder and indigo.",
      category: "home",
      materials: "cotton",
      listPriceMinor: gbp(55),
      floorPriceMinor: gbp(40),
    },
    {
      sellerId: fatima.id,
      title: "Sozni-embroidered silk-wool scarf",
      description: "Hand-embroidered paisley border on a silk-wool blend.",
      category: "scarf",
      stock: 10, // demo pieces: rehearsals shouldn't sell them out
      materials: "silk, fine wool",
      listPriceMinor: gbp(110),
      floorPriceMinor: gbp(84),
    },
    {
      sellerId: fatima.id,
      title: "Embroidered wool shawl",
      description: "Full sozni jaal on fine wool.",
      category: "shawl",
      materials: "fine wool",
      listPriceMinor: gbp(240),
      floorPriceMinor: gbp(190),
    },
    {
      sellerId: fatima.id,
      title: "Embroidered silk pouch",
      description: "Small zip pouch with chain-stitch flowers.",
      category: "accessory",
      materials: "silk",
      listPriceMinor: gbp(25),
      floorPriceMinor: gbp(18),
    },
  ]).returning();

  // Makers from other regions, with their own pieces. None of these listings
  // mention scarves, so they don't change the scarf demo above.
  const regional = await db
    .insert(schema.sellers)
    .values(REGIONAL_SELLERS.map((key) => ({ ...MAKER_ACCOUNTS[key], ...makerFields(key) })))
    .returning();
  const by = Object.fromEntries(regional.map((r) => [r.name, r.id]));
  const regionalListings = await db
    .insert(schema.listings)
    .values(REGIONAL_LISTINGS.map(({ maker, ...l }) => ({ ...l, sellerId: by[MAKERS[maker].name] })))
    .returning();

  // Product photos (with credits), fuller copy, size and care for the demo listings.
  for (const l of [...listings, ...regionalListings]) {
    const photo = PRODUCT_PHOTOS[l.title];
    const copy = PRODUCT_COPY[l.title];
    await db
      .update(schema.listings)
      .set({
        ...(photo ? { images: [photo.url], imageCredit: photo.credit, imageSource: photo.source } : {}),
        ...(copy ?? {}),
      })
      .where(sql`id = ${l.id}`);
  }

  // Two completed historical orders on Meera's stole and cushion cover, each
  // with the mandate and negotiation behind it, so her dashboard is never empty.
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const [stole, cushion] = [listings[1], listings[2]];
  const history = [
    { listing: stole, buyer: "Priya", text: "Silk stole for a wedding, under £75", agreed: 64, daysAgo: 12, carrier: "India Post", tracking: "EE123456789IN" },
    { listing: cushion, buyer: "Tom", text: "Brocade cushion cover under £40", agreed: 38, daysAgo: 5, carrier: "DHL", tracking: "1234567890" },
  ];
  for (const [i, h] of history.entries()) {
    const created = new Date(now - h.daysAgo * day);
    const [mandate] = await db
      .insert(schema.mandates)
      .values({
        buyerName: h.buyer,
        requestText: h.text,
        query: h.listing.category,
        maxPriceMinor: gbp(h.agreed + 10),
        deadline: new Date(now - (h.daysAgo - 20) * day).toISOString().slice(0, 10),
        shipToCountry: "GB",
        status: "recommended",
        createdAt: created,
      })
      .returning();
    const [neg] = await db
      .insert(schema.negotiations)
      .values({
        mandateId: mandate.id,
        listingId: h.listing.id,
        state: "ORDERED",
        sellerOfferMinor: gbp(h.agreed),
        buyerOfferMinor: gbp(h.agreed),
        rounds: 3,
        agreedPriceMinor: gbp(h.agreed),
        createdAt: created,
      })
      .returning();
    await db.update(schema.mandates).set({ recommendedNegotiationId: neg.id }).where(sql`id = ${mandate.id}`);
    await db.insert(schema.orders).values({
      negotiationId: neg.id,
      amountMinor: gbp(h.agreed),
      status: "CAPTURED",
      paypalOrderId: `SEED-ORDER-${i + 1}`,
      authorizationId: `SEED-AUTH-${i + 1}`,
      captureId: `SEED-CAPTURE-${i + 1}`,
      carrier: h.carrier,
      trackingNumber: h.tracking,
      authorizedAt: created,
      capturedAt: new Date(created.getTime() + 2 * day),
      // Past sales were paid out too: the seller's share after Mandix's 5% fee.
      payoutStatus: "SUCCESS",
      payoutBatchId: `SEED-PAYOUT-${i + 1}`,
      payoutMinor: Math.round(gbp(h.agreed) * 0.95),
      feeMinor: gbp(h.agreed) - Math.round(gbp(h.agreed) * 0.95),
      paidOutAt: new Date(created.getTime() + 2 * day),
      createdAt: created,
    });
  }

  // Demo logins: Sarah (buyer) and the three sellers, sharing DEMO_PASSWORD.
  const password = await hashPassword(process.env.DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD);
  const sellerIds = { meera: meera.id, arjun: arjun.id, fatima: fatima.id };
  await db.insert(schema.users).values(
    Object.entries(DEMO_ACCOUNTS).map(([key, a]) => ({
      email: a.email,
      passwordHash: password,
      role: a.role,
      name: a.name,
      sellerId: a.role === "seller" ? sellerIds[key as keyof typeof sellerIds] : null,
      shipToCountry: "GB",
    })),
  );

  console.log("Seeded 4 demo logins (see lib/auth/demo.ts).");
  console.log(`Seeded ${3 + regional.length} sellers, ${listings.length + regionalListings.length} listings, 2 historical orders.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
