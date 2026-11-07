// Seller languages and WhatsApp alerts. The DB parts need TEST_DATABASE_URL.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeWhatsAppNumber } from "@/lib/phone";
import { SELLER_LANGUAGES, SELLER_STRINGS, sellerLanguage } from "@/lib/i18n/seller";

describe("WhatsApp numbers", () => {
  it("accepts international numbers and bare Indian mobiles", () => {
    expect(normalizeWhatsAppNumber("+91 98765 43210")).toBe("+919876543210");
    expect(normalizeWhatsAppNumber("0091-98765-43210")).toBe("+919876543210");
    expect(normalizeWhatsAppNumber("9876543210")).toBe("+919876543210");
    expect(normalizeWhatsAppNumber("+44 7700 900123")).toBe("+447700900123");
  });
  it("rejects anything that isn't a phone number", () => {
    expect(normalizeWhatsAppNumber("12345")).toBeNull();
    expect(normalizeWhatsAppNumber("call me")).toBeNull();
    expect(normalizeWhatsAppNumber("+0 123 456 789")).toBeNull();
  });
});

describe("seller languages", () => {
  it("every language fills every string, and unknown codes fall back to English", () => {
    for (const code of SELLER_LANGUAGES) {
      const t = SELLER_STRINGS[code];
      expect(t.soldTitle("₹1")).toContain("₹1");
      expect(t.shipWithin(3)).toContain("3");
      expect(t.title.length).toBeGreaterThan(0);
    }
    expect(sellerLanguage("xx")).toBe("en");
    expect(sellerLanguage("ta")).toBe("ta");
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("WhatsApp alerts", () => {
  let dbmod: typeof import("@/lib/db");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    delete process.env.TWILIO_ACCOUNT_SID; // record, don't send
    dbmod = await import("@/lib/db");
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await dbmod.db.execute(sql`TRUNCATE whatsapp_messages, notifications, paypal_events, orders, negotiation_turns, negotiations, mandates, listings, users, sellers CASCADE`);
  });

  async function orderFor(seller: Partial<typeof dbmod.schema.sellers.$inferInsert>) {
    const { db, schema } = dbmod;
    const [s] = await db
      .insert(schema.sellers)
      .values({ name: "Kavya", city: "Kanchipuram", country: "IN", story: "Silk weaver.", paypalMerchantEmail: "k@example.com", ...seller })
      .returning();
    await db.insert(schema.users).values({ email: `k${Math.random()}@test.local`, passwordHash: "x", role: "seller", name: "Kavya", sellerId: s.id });
    const [l] = await db
      .insert(schema.listings)
      .values({ sellerId: s.id, title: "Kanjivaram silk saree", description: "Handwoven.", category: "saree", materials: "silk", listPriceMinor: 20000, floorPriceMinor: 15000 })
      .returning();
    const [m] = await db
      .insert(schema.mandates)
      .values({ buyerName: "Sarah", requestText: "saree", query: "saree", maxPriceMinor: 20000, deadline: "2026-12-20", shipToCountry: "GB" })
      .returning();
    const [n] = await db.insert(schema.negotiations).values({ mandateId: m.id, listingId: l.id, state: "AGREED", agreedPriceMinor: 18000 }).returning();
    const [o] = await db.insert(schema.orders).values({ negotiationId: n.id, amountMinor: 18000, status: "AUTHORIZED" }).returning();
    return { seller: s, order: o };
  }

  const settle = () => new Promise((r) => setTimeout(r, 200)); // WhatsApp is sent without blocking

  it("a Tamil seller who opted in gets the sale on WhatsApp, in Tamil", async () => {
    const { notifyOrder } = await import("@/lib/notify");
    const { seller, order } = await orderFor({ language: "ta", whatsappNumber: "+919876543210", whatsappOptIn: true });
    await notifyOrder(order.id, "held");
    await settle();
    const msgs = await dbmod.db.select().from(dbmod.schema.whatsappMessages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].sellerId).toBe(seller.id);
    expect(msgs[0].to).toBe("+919876543210");
    expect(msgs[0].status).toBe("logged");
    expect(msgs[0].body).toContain("விற்பனையானது!");
    expect(msgs[0].body).toContain("₹");
    const [alert] = await dbmod.db.select().from(dbmod.schema.notifications);
    expect(alert.title).toContain("விற்பனையானது!");
  });

  it("no WhatsApp without the seller's opt-in", async () => {
    const { notifyOrder } = await import("@/lib/notify");
    const { order } = await orderFor({ language: "hi", whatsappNumber: "+919876543210", whatsappOptIn: false });
    await notifyOrder(order.id, "held");
    await settle();
    expect(await dbmod.db.select().from(dbmod.schema.whatsappMessages)).toHaveLength(0);
  });
});

describe("banner links", () => {
  it("only a correctly signed link opens a card", async () => {
    process.env.SESSION_SECRET ??= "test-secret";
    const { signBanner, verifyBanner } = await import("@/lib/banner");
    const parts = ["held", "11111111-1111-1111-1111-111111111111", "0"];
    const sig = signBanner(parts);
    expect(verifyBanner(parts, sig)).toBe(true);
    expect(verifyBanner(["held", "22222222-2222-2222-2222-222222222222", "0"], sig)).toBe(false);
    expect(verifyBanner(["refunded", parts[1], "999999"], sig)).toBe(false);
    expect(verifyBanner(parts, null)).toBe(false);
  });

  it("cards escape seller-written text", async () => {
    const { bannerHtml } = await import("@/lib/banner");
    const html = bannerHtml({
      lang: "hi", tone: "agreed", chip: null, headline: "बिक गया!", sub: null, body: null,
      listingTitle: '<img src=x onerror="alert(1)">', image: null, sellerName: "Meera",
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain("&lt;img src=x");
  });
});
