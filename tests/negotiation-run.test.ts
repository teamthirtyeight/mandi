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

  async function mandate(hostile = false, compromised = false) {
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
        compromised,
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

  it("compromised seller: the £1 offer is blocked and the leaked floor never reaches the buyer", async () => {
    const m = await mandate(true, true);
    await runner.openNegotiations(m.id);
    await runner.runMandate(m.id);
    const snap = (await snapshot.getMandateSnapshot(m.id))!;

    const blocks = snap.turns.filter((t) => t.from === "engine" && t.guardrail_result === "REJECTED_BELOW_FLOOR");
    expect(blocks).toHaveLength(3); // one per seller
    expect(blocks.every((t) => !/£68\b|£98\b|£84\b/.test(t.message))).toBe(true);

    const delivered = snap.turns.filter((t) => t.from === "seller");
    const leaks = delivered.filter((t) => t.limit_redacted);
    expect(leaks).toHaveLength(3);
    expect(leaks.every((t) => t.message.includes("my floor is [withheld]"))).toBe(true);
    const floors: Record<string, number> = { Meera: 68, Arjun: 98, Fatima: 84 };
    for (const t of delivered) expect(t.message).not.toContain(`£${floors[t.seller]}.`);
  });

  it("a run stuck before a restart is marked interrupted and its open negotiations closed", async () => {
    const { recoverStuckRuns } = await import("@/lib/negotiation/recovery");
    const { eq } = await import("drizzle-orm");
    const { db, schema } = dbmod;
    const m = await mandate();
    await runner.openNegotiations(m.id);
    await db
      .update(schema.mandates)
      .set({ status: "negotiating", createdAt: new Date(Date.now() - 20 * 60 * 1000) })
      .where(eq(schema.mandates.id, m.id));
    const fresh = await mandate();
    await db.update(schema.mandates).set({ status: "negotiating" }).where(eq(schema.mandates.id, fresh.id));

    expect(await recoverStuckRuns()).toEqual([m.id]);
    const snap = (await snapshot.getMandateSnapshot(m.id))!;
    expect(snap.mandate.status).toBe("interrupted");
    expect(snap.negotiations.every((n) => n.state === "EXPIRED")).toBe(true);
    expect((await snapshot.getMandateSnapshot(fresh.id))!.mandate.status).toBe("negotiating");
  });

  it("a cancel mid-run closes every negotiation, even ones that were about to agree", async () => {
    const { eq } = await import("drizzle-orm");
    const { db, schema } = dbmod;
    process.env.MANDI_TURN_DELAY_MS = "40";
    try {
      const m = await mandate();
      await runner.openNegotiations(m.id);
      const run = runner.runMandate(m.id);
      await new Promise((r) => setTimeout(r, 120));
      await db.update(schema.mandates).set({ status: "cancelled" }).where(eq(schema.mandates.id, m.id));
      await run;
      const snap = (await snapshot.getMandateSnapshot(m.id))!;
      expect(snap.mandate.status).toBe("cancelled");
      expect(snap.negotiations.every((n) => n.state === "WALKED_AWAY" && n.agreedPrice == null)).toBe(true);
    } finally {
      process.env.MANDI_TURN_DELAY_MS = "0";
    }
  });
});

