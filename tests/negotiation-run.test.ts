// Full mandate run against Postgres with the model switched off (rule-based
// turns), so the outcome is deterministic: one sentence → three negotiations →
// a recommended deal, with every price inside the limits.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("negotiation run", () => {
  let dbmod: typeof import("@/lib/db");
  let runner: typeof import("@/lib/negotiation/runner");
  let snapshot: typeof import("@/lib/negotiation/snapshot");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.MANDI_FAKE_AI = "1";
    process.env.MANDI_TURN_DELAY_MS = "0";
    delete process.env.CHANNEL3_API_KEY;
    dbmod = await import("@/lib/db");
    runner = await import("@/lib/negotiation/runner");
    snapshot = await import("@/lib/negotiation/snapshot");
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    const { db, schema } = dbmod;
    await db.execute(sql`TRUNCATE paypal_events, orders, negotiation_turns, negotiations, mandates, listings, sellers CASCADE`);
    const sellers = await db
      .insert(schema.sellers)
      .values(
        ["Meera", "Arjun", "Fatima"].map((name) => ({
          name,
          city: "Varanasi",
          country: "IN",
          story: "Artisan.",
          paypalMerchantEmail: `${name.toLowerCase()}@example.com`,
          shipByDays: 2,
          transitDays: 6,
        })),
      )
      .returning();
    const [meera, arjun, fatima] = sellers;
    await db.insert(schema.listings).values([
      { sellerId: meera.id, title: "Handwoven silk scarf", description: "Banarasi silk scarf.", category: "scarf", materials: "silk", listPriceMinor: 9500, floorPriceMinor: 6800 },
      { sellerId: arjun.id, title: "Indigo silk scarf", description: "Block-printed silk scarf.", category: "scarf", materials: "silk", listPriceMinor: 12000, floorPriceMinor: 9800 },
      { sellerId: fatima.id, title: "Embroidered silk scarf", description: "Sozni silk-wool scarf.", category: "scarf", materials: "silk, wool", listPriceMinor: 11000, floorPriceMinor: 8400 },
      { sellerId: fatima.id, title: "Wool shawl", description: "Embroidered shawl.", category: "shawl", materials: "wool", listPriceMinor: 24000, floorPriceMinor: 19000 },
    ]);
  });

  async function mandate(hostile = false) {
    const { db, schema } = dbmod;
    const [m] = await db
      .insert(schema.mandates)
      .values({
        buyerName: "Sarah",
        requestText: "Handwoven silk scarf for my mum, under £90, by Dec 20",
        query: "handwoven silk scarf",
        maxPriceMinor: 9000,
        deadline: "2026-12-20",
        shipToCountry: "GB",
        hostile,
      })
      .returning();
    return m;
  }

  it("negotiates with three sellers and recommends one deal inside the limits", async () => {
    const m = await mandate();
    const opened = await runner.openNegotiations(m.id);
    expect(opened).toHaveLength(3);

    await runner.runMandate(m.id);
    const snap = (await snapshot.getMandateSnapshot(m.id))!;

    expect(snap.mandate.status).toBe("recommended");
    const states = Object.fromEntries(snap.negotiations.map((n) => [n.seller.name, n.state]));
    expect(states.Arjun).toBe("WALKED_AWAY"); // floor £98 is above the £90 budget
    expect(states.Meera).toBe("AGREED");

    const best = snap.negotiations.find((n) => n.id === snap.mandate.recommendedNegotiationId)!;
    expect(best.agreedPrice).toBeLessThanOrEqual(90);

    const floors: Record<string, number> = { Meera: 68, Arjun: 98, Fatima: 84 };
    for (const t of snap.turns) {
      if (t.from === "seller" && t.final_price != null) expect(t.final_price).toBeGreaterThanOrEqual(floors[t.seller]);
      if (t.from === "buyer" && t.final_price != null) expect(t.final_price).toBeLessThanOrEqual(90);
    }
  });

  it("a second confirm is refused", async () => {
    const m = await mandate();
    await runner.openNegotiations(m.id);
    expect(await runner.openNegotiations(m.id)).toBeNull();
  });

  it("hostile buyer: the injection is labelled and no seller goes below its floor", async () => {
    const m = await mandate(true);
    await runner.openNegotiations(m.id);
    await runner.runMandate(m.id);
    const snap = (await snapshot.getMandateSnapshot(m.id))!;

    const hostile = snap.turns.filter((t) => t.source === "script");
    expect(hostile).toHaveLength(3);
    expect(hostile.every((t) => t.injection)).toBe(true);

    const floors: Record<string, number> = { Meera: 68, Arjun: 98, Fatima: 84 };
    for (const t of snap.turns.filter((t) => t.from === "seller" && t.final_price != null)) {
      expect(t.final_price).toBeGreaterThanOrEqual(floors[t.seller]);
    }
  });
});
