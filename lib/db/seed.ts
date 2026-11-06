// Demo seed: 3 sellers, 8 listings, 1 mandate-ready buyer, 2 historical orders.
// The three scarf listings are tuned so every run shows three outcomes against
// Sarah's £90 ceiling: Meera agrees, Arjun walks away (floor above ceiling),
// Fatima's negotiation pushes the buyer into the ceiling clamp.
import "dotenv/config";
import { db, schema } from "./index";
import { sql } from "drizzle-orm";

const gbp = (pounds: number) => Math.round(pounds * 100);

async function main() {
  await db.execute(sql`
    TRUNCATE paypal_events, orders, negotiation_turns, negotiations,
             mandates, listings, sellers RESTART IDENTITY CASCADE
  `);

  const [meera, arjun, fatima] = await db
    .insert(schema.sellers)
    .values([
      {
        name: "Meera",
        city: "Varanasi",
        country: "IN",
        story:
          "Third-generation handloom weaver. Each silk piece takes about four days on the loom.",
        paypalMerchantEmail: process.env.SELLER_MEERA_EMAIL ?? "meera@example.com",
        language: "hi",
        shipByDays: 2,
        transitDays: 6,
      },
      {
        name: "Arjun",
        city: "Jaipur",
        country: "IN",
        story: "Block printer working with natural indigo and madder dyes.",
        paypalMerchantEmail: process.env.SELLER_ARJUN_EMAIL ?? "arjun@example.com",
        shipByDays: 3,
        transitDays: 7,
      },
      {
        name: "Fatima",
        city: "Srinagar",
        country: "IN",
        story: "Kashmiri embroiderer; hand-stitched sozni work on wool and silk.",
        paypalMerchantEmail: process.env.SELLER_FATIMA_EMAIL ?? "fatima@example.com",
        shipByDays: 3,
        transitDays: 8,
      },
    ])
    .returning();

  await db.insert(schema.listings).values([
    {
      sellerId: meera.id,
      title: "Handwoven Banarasi silk scarf, rose and gold",
      description: "Pure mulberry silk with a zari border, woven on a pit loom.",
      category: "scarf",
      materials: "mulberry silk, zari",
      listPriceMinor: gbp(95),
      floorPriceMinor: gbp(68),
    },
    {
      sellerId: meera.id,
      title: "Banarasi silk stole, peacock blue",
      description: "Lightweight silk stole with a small butti pattern.",
      category: "scarf",
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
  ]);

  // Two completed historical orders so the dashboard is never empty.
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  await db.insert(schema.orders).values([
    {
      amountMinor: gbp(64),
      status: "CAPTURED",
      paypalOrderId: "SEED-ORDER-1",
      authorizationId: "SEED-AUTH-1",
      captureId: "SEED-CAPTURE-1",
      carrier: "India Post",
      trackingNumber: "EE123456789IN",
      authorizedAt: new Date(now - 12 * day),
      capturedAt: new Date(now - 10 * day),
    },
    {
      amountMinor: gbp(38),
      status: "CAPTURED",
      paypalOrderId: "SEED-ORDER-2",
      authorizationId: "SEED-AUTH-2",
      captureId: "SEED-CAPTURE-2",
      carrier: "DHL",
      trackingNumber: "1234567890",
      authorizedAt: new Date(now - 5 * day),
      capturedAt: new Date(now - 4 * day),
    },
  ]);

  console.log("Seeded 3 sellers, 8 listings, 2 historical orders.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
