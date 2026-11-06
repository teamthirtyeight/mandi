// Webhook listener against Postgres, with PayPal's signature verification
// mocked at fetch. Needs TEST_DATABASE_URL; skipped otherwise.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("PayPal webhook listener", () => {
  let dbmod: typeof import("@/lib/db");
  let route: typeof import("@/app/api/paypal/webhook/route");
  let verification = "SUCCESS";
  let verifyCalls = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.PAYPAL_CLIENT_ID = "test-id";
    process.env.PAYPAL_CLIENT_SECRET = "test-secret";
    process.env.PAYPAL_WEBHOOK_ID = "WH-TEST";
    dbmod = await import("@/lib/db");
    route = await import("@/app/api/paypal/webhook/route");
  });

  beforeEach(async () => {
    verification = "SUCCESS";
    verifyCalls = 0;
    const { sql } = await import("drizzle-orm");
    await dbmod.db.execute(sql`TRUNCATE paypal_events, orders RESTART IDENTITY CASCADE`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname;
        const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
        if (path === "/v1/oauth2/token") return json({ access_token: "tok", expires_in: 3600 });
        if (path === "/v1/notifications/verify-webhook-signature") {
          verifyCalls++;
          const body = JSON.parse(String(init.body));
          expect(body.webhook_id).toBe("WH-TEST");
          expect(body.transmission_id).toBe("tx-1");
          return json({ verification_status: verification });
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const send = (event: unknown) =>
    route.POST(
      new Request("http://localhost/api/paypal/webhook", {
        method: "POST",
        headers: {
          "paypal-auth-algo": "SHA256withRSA",
          "paypal-cert-url": "https://api.sandbox.paypal.com/cert",
          "paypal-transmission-id": "tx-1",
          "paypal-transmission-sig": "sig",
          "paypal-transmission-time": new Date().toISOString(),
        },
        body: JSON.stringify(event),
      }),
    );

  const authorizationCreated = {
    event_type: "PAYMENT.AUTHORIZATION.CREATED",
    summary: "Payment authorization created",
    resource: { id: "AUTH-WH-1", supplementary_data: { related_ids: { order_id: "ORDERWEBHOOK0001" } } },
  };

  async function order(status: "CREATED" | "CAPTURED") {
    const [row] = await dbmod.db
      .insert(dbmod.schema.orders)
      .values({ amountMinor: 8000, status, paypalOrderId: "ORDERWEBHOOK0001" })
      .returning();
    return row;
  }

  it("a signed webhook that arrives before the redirect moves the order to AUTHORIZED", async () => {
    const o = await order("CREATED");
    const res = await send(authorizationCreated);
    expect(res.status).toBe(200);
    expect(verifyCalls).toBe(1);

    const { eq } = await import("drizzle-orm");
    const [after] = await dbmod.db.select().from(dbmod.schema.orders).where(eq(dbmod.schema.orders.id, o.id));
    expect(after.status).toBe("AUTHORIZED");
    expect(after.authorizationId).toBe("AUTH-WH-1");

    const events = await dbmod.db.select().from(dbmod.schema.paypalEvents);
    expect(events.some((e) => e.direction === "webhook" && e.endpoint === "PAYMENT.AUTHORIZATION.CREATED" && e.orderId === o.id)).toBe(true);
  });

  it("a stale webhook after capture never moves the order backwards", async () => {
    const o = await order("CAPTURED");
    await send(authorizationCreated);
    const { eq } = await import("drizzle-orm");
    const [after] = await dbmod.db.select().from(dbmod.schema.orders).where(eq(dbmod.schema.orders.id, o.id));
    expect(after.status).toBe("CAPTURED");
  });

  it("rejects a webhook whose signature PayPal doesn't verify, and changes nothing", async () => {
    const o = await order("CREATED");
    verification = "FAILURE";
    const res = await send(authorizationCreated);
    expect(res.status).toBe(400);
    const { eq } = await import("drizzle-orm");
    const [after] = await dbmod.db.select().from(dbmod.schema.orders).where(eq(dbmod.schema.orders.id, o.id));
    expect(after.status).toBe("CREATED");
    expect(await dbmod.db.select().from(dbmod.schema.paypalEvents).then((e) => e.filter((x) => x.direction === "webhook"))).toHaveLength(0);
  });
});
