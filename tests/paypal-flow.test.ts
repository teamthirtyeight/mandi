// Money-path test: the real order service against a real Postgres, with
// PayPal's REST API mocked at fetch. Needs TEST_DATABASE_URL (schema pushed);
// skipped otherwise. Covers the sandbox test matrix rows that don't need a
// human in the PayPal popup.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

type Call = { method: string; path: string; headers: Record<string, string>; body: unknown };

describe.skipIf(!TEST_DB)("PayPal money flow", () => {
  let calls: Call[];
  let failCapture = false;
  let svc: typeof import("@/lib/orders/service");
  let dbmod: typeof import("@/lib/db");

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.PAYPAL_CLIENT_ID = "test-id";
    process.env.PAYPAL_CLIENT_SECRET = "test-secret";
    process.env.MANDI_FAKE_AI = "1";
    dbmod = await import("@/lib/db");
    svc = await import("@/lib/orders/service");
  });

  beforeEach(async () => {
    calls = [];
    failCapture = false;
    const { sql } = await import("drizzle-orm");
    await dbmod.db.execute(sql`TRUNCATE paypal_events, orders RESTART IDENTITY CASCADE`);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        const headers = (init.headers ?? {}) as Record<string, string>;
        const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body;
        calls.push({ method: init.method ?? "GET", path, headers, body });
        const json = (status: number, data: unknown) =>
          new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

        if (path === "/v1/oauth2/token") return json(200, { access_token: "tok", expires_in: 3600 });
        if (path.endsWith("/capture")) {
          if (failCapture) return json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] });
          return json(201, { id: "CAP-1", status: "COMPLETED", amount: { currency_code: "GBP", value: "72.00" } });
        }
        if (path.endsWith("/track")) return json(201, { id: "ORDER-1" });
        if (path.endsWith("/refund")) return json(201, { id: `REF-${calls.length}`, status: "COMPLETED" });
        if (path.endsWith("/void")) return new Response(null, { status: 204 });
        return json(404, { name: "NOT_FOUND" });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  async function authorizedOrder(amountMinor = 7200) {
    const [row] = await dbmod.db
      .insert(dbmod.schema.orders)
      .values({
        amountMinor,
        status: "AUTHORIZED",
        paypalOrderId: "ORDER1234567890",
        authorizationId: "AUTH-1",
        authorizedAt: new Date(),
      })
      .returning();
    return row;
  }

  const moneyPosts = () => calls.filter((c) => c.method === "POST" && c.path !== "/v1/oauth2/token");

  it("happy path: ship captures, attaches tracking, amounts match to the penny", async () => {
    const order = await authorizedOrder();
    const { order: shipped, trackingWarning } = await svc.shipOrder(order.id, {
      carrier: "India Post",
      trackingNumber: "EE123456789IN",
    });

    expect(trackingWarning).toBeNull();
    expect(shipped.status).toBe("CAPTURED");
    expect(shipped.captureId).toBe("CAP-1");
    expect(moneyPosts().map((c) => c.path)).toEqual([
      "/v2/payments/authorizations/AUTH-1/capture",
      "/v2/checkout/orders/ORDER1234567890/track",
    ]);
    const track = moneyPosts()[1].body as Record<string, unknown>;
    expect(track).toMatchObject({ capture_id: "CAP-1", tracking_number: "EE123456789IN", notify_payer: true });
  });

  it("sends a PayPal-Request-Id on every POST", async () => {
    const order = await authorizedOrder();
    await svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" });
    for (const c of moneyPosts()) expect(c.headers["PayPal-Request-Id"]).toBeTruthy();
  });

  it("a second ship is refused and captures only once", async () => {
    const order = await authorizedOrder();
    await svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" });
    await expect(svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" })).rejects.toMatchObject({
      status: 409,
    });
    expect(calls.filter((c) => c.path.endsWith("/capture"))).toHaveLength(1);
  });

  it("a declined capture puts the order back to AUTHORIZED", async () => {
    const order = await authorizedOrder();
    failCapture = true;
    await expect(svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" })).rejects.toThrow(
      /INSTRUMENT_DECLINED/,
    );
    expect((await svc.getOrderRow(order.id)).status).toBe("AUTHORIZED");
  });

  it("partial then full refund ends REFUNDED; over-refund is rejected", async () => {
    const order = await authorizedOrder();
    await svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" });

    const partial = await svc.refundOrder(order.id, { amountMinor: 1000, requestKey: "k1", approvedBy: "seller" });
    expect(partial.outcome).toBe("REFUNDED");
    expect(partial.order.refundedMinor).toBe(1000);
    expect(partial.order.status).toBe("CAPTURED");

    await expect(
      svc.refundOrder(order.id, { amountMinor: 6300, requestKey: "k2", approvedBy: "seller" }),
    ).rejects.toMatchObject({ status: 422 });

    const full = await svc.refundOrder(order.id, { amountMinor: 6200, requestKey: "k3", approvedBy: "seller" });
    expect(full.order.status).toBe("REFUNDED");
    expect(full.order.refundedMinor).toBe(7200);

    const refundBody = calls.filter((c) => c.path.endsWith("/refund"))[0].body as { amount: { value: string } };
    expect(refundBody.amount.value).toBe("10.00");
  });

  it("an agent refund above the seller's cap needs the seller's tap", async () => {
    const order = await authorizedOrder();
    await svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" });
    const res = await svc.refundOrder(order.id, { amountMinor: 2000, requestKey: "k4", approvedBy: "agent" });
    expect(res.outcome).toBe("NEEDS_SELLER_APPROVAL");
    expect(calls.filter((c) => c.path.endsWith("/refund"))).toHaveLength(0);
  });

  it("void before shipment releases the hold; it can't be shipped afterwards", async () => {
    const order = await authorizedOrder();
    const voided = await svc.voidOrder(order.id);
    expect(voided.status).toBe("VOIDED");
    expect(calls.some((c) => c.path === "/v2/payments/authorizations/AUTH-1/void")).toBe(true);
    await expect(svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("logs every PayPal call to paypal_events", async () => {
    const order = await authorizedOrder();
    await svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" });
    const events = await dbmod.db.select().from(dbmod.schema.paypalEvents);
    expect(events.map((e) => e.endpoint)).toEqual(
      expect.arrayContaining(["/v2/payments/authorizations/AUTH-1/capture", "/v2/checkout/orders/ORDER1234567890/track"]),
    );
  });

  it("buyer reports a problem: the agent's refund within the cap goes straight through", async () => {
    const { reportProblem } = await import("@/lib/orders/problem");
    const order = await authorizedOrder();
    await svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" });

    const res = await reportProblem(order.id, { description: "A thread has pulled.", photo: null, requestKey: "p1" });
    expect(res.outcome).toBe("REFUNDED");
    expect(res.amountMinor).toBe(1000); // 15% of £72 = £11, capped at the £10 default
    expect(res.order.refundedMinor).toBe(1000);
    expect(res.order.problemNote).toBe("A thread has pulled.");
    expect(res.order.pendingRefundMinor).toBeNull();

    await expect(reportProblem(order.id, { description: "Again", photo: null, requestKey: "p2" })).resolves.toBeTruthy();
  });

  it("auto-voids a hold the seller didn't ship in time, and leaves fresh ones", async () => {
    const { voidExpiredHolds } = await import("@/lib/orders/expiry");
    const stale = await authorizedOrder();
    const { eq } = await import("drizzle-orm");
    await dbmod.db
      .update(dbmod.schema.orders)
      .set({ authorizedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) })
      .where(eq(dbmod.schema.orders.id, stale.id));
    const [fresh] = await dbmod.db
      .insert(dbmod.schema.orders)
      .values({ amountMinor: 5000, status: "AUTHORIZED", paypalOrderId: "ORDERFRESH12345", authorizationId: "AUTH-2", authorizedAt: new Date() })
      .returning();

    const voided = await voidExpiredHolds();
    expect(voided).toEqual([stale.id]);
    expect((await svc.getOrderRow(stale.id)).status).toBe("VOIDED");
    expect((await svc.getOrderRow(fresh.id)).status).toBe("AUTHORIZED");
    expect(calls.some((c) => c.path === "/v2/payments/authorizations/AUTH-1/void")).toBe(true);
  });
});
