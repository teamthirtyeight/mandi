// The job queue and worker (lib/jobs), and live events across processes
// (lib/negotiation/bus.ts). Needs TEST_DATABASE_URL.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("job queue", () => {
  let dbmod: typeof import("@/lib/db");
  let q: typeof import("@/lib/jobs/queue");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.MANDIX_FAKE_AI = "1";
    delete process.env.TWILIO_ACCOUNT_SID;
    dbmod = await import("@/lib/db");
    q = await import("@/lib/jobs/queue");
  });

  beforeEach(async () => {
    const { sql } = await import("drizzle-orm");
    await dbmod.db.execute(sql`TRUNCATE jobs`);
  });

  it("two workers never claim the same job", async () => {
    await q.enqueue("whatsapp", { n: 1 });
    await q.enqueue("whatsapp", { n: 2 });
    const [a, b, c] = await Promise.all([q.claimNext("w1"), q.claimNext("w2"), q.claimNext("w3")]);
    const claimed = [a, b, c].filter(Boolean);
    expect(claimed).toHaveLength(2);
    expect(new Set(claimed.map((j) => j!.id)).size).toBe(2);
    expect(claimed.every((j) => j!.status === "running" && j!.attempts === 1)).toBe(true);
  });

  it("a failed job is retried later, then failed for good after its last attempt", async () => {
    const { eq } = await import("drizzle-orm");
    await q.enqueue("whatsapp", {}, { maxAttempts: 2 });
    let job = (await q.claimNext("w"))!;
    expect(await q.fail(job, new Error("Twilio down"))).toBe(false);
    let [row] = await dbmod.db.select().from(dbmod.schema.jobs).where(eq(dbmod.schema.jobs.id, job.id));
    expect(row.status).toBe("queued");
    expect(row.runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(await q.claimNext("w")).toBeNull(); // backing off
    await dbmod.db.update(dbmod.schema.jobs).set({ runAfter: new Date() }).where(eq(dbmod.schema.jobs.id, job.id));
    job = (await q.claimNext("w"))!;
    expect(await q.fail(job, new Error("still down"))).toBe(true);
    [row] = await dbmod.db.select().from(dbmod.schema.jobs).where(eq(dbmod.schema.jobs.id, job.id));
    expect(row).toMatchObject({ status: "failed", lastError: "still down" });
  });

  it("a negotiation whose worker died is closed as interrupted, not left running", async () => {
    const { eq } = await import("drizzle-orm");
    const [m] = await dbmod.db
      .insert(dbmod.schema.mandates)
      .values({ buyerName: "Sarah", requestText: "scarf", query: "scarf", maxPriceMinor: 9000, deadline: "2026-12-20", shipToCountry: "GB", status: "negotiating" })
      .returning();
    await q.enqueue("negotiate", { mandateId: m.id }, { maxAttempts: 1 });
    const job = (await q.claimNext("dead-worker"))!;
    // The worker stops sending heartbeats.
    await dbmod.db.update(dbmod.schema.jobs).set({ heartbeatAt: new Date(Date.now() - 5 * 60_000) }).where(eq(dbmod.schema.jobs.id, job.id));
    const { recoverDeadJobs } = await import("@/lib/jobs/worker");
    expect(await recoverDeadJobs()).toBe(1);
    const [after] = await dbmod.db.select().from(dbmod.schema.mandates).where(eq(dbmod.schema.mandates.id, m.id));
    expect(after.status).toBe("interrupted");
  });

  it("a worker runs a queued negotiation to the end", async () => {
    const { eq, sql } = await import("drizzle-orm");
    const { sellerWithOrder, TRUNCATE_ALL } = await import("./helpers/fixtures");
    await dbmod.db.execute(sql.raw(TRUNCATE_ALL));
    const { listing, buyer } = await sellerWithOrder(dbmod);
    const [m] = await dbmod.db
      .insert(dbmod.schema.mandates)
      .values({ buyerName: "Sarah", buyerUserId: buyer.id, requestText: "silk saree under £190", query: "silk saree", maxPriceMinor: 19000, deadline: "2026-12-20", shipToCountry: "GB" })
      .returning();
    const { openNegotiations } = await import("@/lib/negotiation/runner");
    await openNegotiations(m.id);
    void listing;
    await q.enqueue("negotiate", { mandateId: m.id }, { maxAttempts: 1 });
    const { startWorker } = await import("@/lib/jobs/worker");
    const worker = startWorker({ concurrency: 2 });
    try {
      for (let i = 0; i < 100; i++) {
        const [row] = await dbmod.db.select().from(dbmod.schema.mandates).where(eq(dbmod.schema.mandates.id, m.id));
        if (!["confirmed", "negotiating"].includes(row.status)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await worker.stop();
    }
    const [done] = await dbmod.db.select().from(dbmod.schema.mandates).where(eq(dbmod.schema.mandates.id, m.id));
    expect(["recommended", "no_deal"]).toContain(done.status);
    const [job] = await dbmod.db.select().from(dbmod.schema.jobs);
    expect(job.status).toBe("done");
  });
});

describe.skipIf(!TEST_DB)("live events across processes", () => {
  it("an event published on one connection reaches a subscriber listening on another, in order", async () => {
    process.env.DATABASE_URL = TEST_DB;
    const bus = await import("@/lib/negotiation/bus");
    const postgres = (await import("postgres")).default;
    const id = "11111111-2222-3333-4444-555555555555";
    const got: string[] = [];
    const unsubscribe = bus.subscribe(id, (e) => got.push(e.type === "state" ? e.state : e.type));
    expect(await bus.ready()).toBe(true);
    // Another process (a worker) publishes through Postgres directly.
    const other = postgres(TEST_DB!, { max: 1 });
    for (const state of ["COUNTERED", "AGREED"]) {
      await other.notify(bus.EVENTS_CHANNEL, JSON.stringify({ m: id, e: { type: "state", negotiation_id: "n", state, agreed_price: null, reason: null } }));
    }
    await other.notify(bus.EVENTS_CHANNEL, JSON.stringify({ m: id, e: { type: "done", mandate_id: id, status: "recommended" } }));
    for (let i = 0; i < 50 && got.length < 3; i++) await new Promise((r) => setTimeout(r, 50));
    await other.end();
    unsubscribe();
    expect(got).toEqual(["COUNTERED", "AGREED", "done"]);
  });
});
