// Seller payouts after capture (lib/orders/payout.ts), with PayPal mocked at fetch.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { payoutSplit } from "@/lib/orders/payout-split";
import { sellerWithOrder, TRUNCATE_ALL } from "./helpers/fixtures";

describe("payout split", () => {
  it("takes Mandi's fee, then any refund debt, and never goes below zero", () => {
    expect(payoutSplit({ capturedMinor: 18000, refundedMinor: 0, debtMinor: 0, feePct: 5 })).toEqual({ feeMinor: 900, debtUsedMinor: 0, payoutMinor: 17100 });
    expect(payoutSplit({ capturedMinor: 18000, refundedMinor: 0, debtMinor: 2000, feePct: 5 })).toEqual({ feeMinor: 900, debtUsedMinor: 2000, payoutMinor: 15100 });
    expect(payoutSplit({ capturedMinor: 1000, refundedMinor: 0, debtMinor: 5000, feePct: 5 })).toEqual({ feeMinor: 50, debtUsedMinor: 950, payoutMinor: 0 });
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("seller payouts", () => {
  let dbmod: typeof import("@/lib/db");
  let paths: { method: string; path: string; body: unknown; requestId?: string }[];
  let failPayout = false;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.PAYPAL_CLIENT_ID = "test-id";
    process.env.PAYPAL_CLIENT_SECRET = "test-secret";
    process.env.MANDI_FAKE_AI = "1";
    delete process.env.MANDI_FEE_PCT;
    delete process.env.TWILIO_ACCOUNT_SID;
    dbmod = await import("@/lib/db");
  });

  beforeEach(async () => {
    paths = [];
    failPayout = false;
    const { sql } = await import("drizzle-orm");
    await dbmod.db.execute(sql.raw(TRUNCATE_ALL));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = new URL(url).pathname;
        const headers = (init.headers ?? {}) as Record<string, string>;
        const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
        paths.push({ method: init.method ?? "GET", path, body, requestId: headers["PayPal-Request-Id"] });
        const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
        if (path === "/v1/oauth2/token") return json(200, { access_token: "tok", expires_in: 3600 });
        if (path.endsWith("/capture")) return json(201, { id: "CAP-1", status: "COMPLETED" });
        if (path.endsWith("/track")) return json(201, { id: "ORDER-1" });
        if (path.endsWith("/refund")) return json(201, { id: `REF-${paths.length}`, status: "COMPLETED" });
        if (path === "/v1/payments/payouts" && init.method === "POST") {
          if (failPayout) return json(422, { name: "INSUFFICIENT_FUNDS" });
          return json(201, { batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } });
        }
        if (path === "/v1/payments/payouts/BATCH-1") return json(200, { batch_header: { batch_status: "SUCCESS" }, items: [{ transaction_status: "SUCCESS" }] });
        return json(404, { name: "NOT_FOUND" });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shipping captures the money and pays the seller their share once, to their PayPal email", async () => {
    const svc = await import("@/lib/orders/service");
    const { order } = await sellerWithOrder(dbmod);
    const { order: shipped } = await svc.shipOrder(order.id, { carrier: "India Post", trackingNumber: "EE123456789IN" });
    expect(shipped.payoutStatus).toBe("PENDING");
    expect(shipped.payoutMinor).toBe(17100);
    expect(shipped.feeMinor).toBe(900);
    const payout = paths.find((p) => p.path === "/v1/payments/payouts")!;
    expect(payout.body).toMatchObject({
      sender_batch_header: { sender_batch_id: `mandi-order-${order.id}` },
      items: [{ receiver: "kavya@example.com", amount: { value: "171.00", currency: "GBP" } }],
    });
    // A second attempt does nothing: the order is already claimed.
    const { payOutOrder } = await import("@/lib/orders/payout");
    await payOutOrder(order.id);
    expect(paths.filter((p) => p.path === "/v1/payments/payouts")).toHaveLength(1);
  });

  it("the seller is told in their language, with rupees", async () => {
    const svc = await import("@/lib/orders/service");
    const { order, sellerUser } = await sellerWithOrder(dbmod, { seller: { language: "hi" } });
    await svc.shipOrder(order.id, { carrier: "India Post", trackingNumber: "EE123456789IN" });
    const alerts = await dbmod.db.select().from(dbmod.schema.notifications);
    const paid = alerts.find((a) => a.userId === sellerUser.id && a.title.includes("PayPal में भेजा गया"));
    expect(paid?.title).toContain("₹");
  });

  it("no payout when the seller was paid directly as the payee", async () => {
    const svc = await import("@/lib/orders/service");
    const { order } = await sellerWithOrder(dbmod, { order: { payeeEmail: "kavya@example.com" } });
    const { order: shipped } = await svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" });
    expect(shipped.payoutStatus).toBeNull();
    expect(paths.some((p) => p.path === "/v1/payments/payouts")).toBe(false);
  });

  it("a failed payout leaves the capture in place, records why, and can be retried", async () => {
    const svc = await import("@/lib/orders/service");
    const { retryPayout } = await import("@/lib/orders/payout");
    const { order } = await sellerWithOrder(dbmod);
    failPayout = true;
    const { order: shipped } = await svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" });
    expect(shipped.status).toBe("CAPTURED");
    expect(shipped.payoutStatus).toBe("FAILED");
    expect(shipped.payoutError).toContain("INSUFFICIENT_FUNDS");
    failPayout = false;
    const retried = await retryPayout(order.id);
    expect(retried?.payoutStatus).toBe("PENDING");
  });

  it("a refund after the payout comes off the seller's next payout", async () => {
    const svc = await import("@/lib/orders/service");
    const { order, seller } = await sellerWithOrder(dbmod);
    await svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" });
    await svc.refundOrder(order.id, { amountMinor: 2000, requestKey: "r1", approvedBy: "seller" });
    const { eq } = await import("drizzle-orm");
    const [s] = await dbmod.db.select().from(dbmod.schema.sellers).where(eq(dbmod.schema.sellers.id, seller.id));
    expect(s.payoutDebtMinor).toBe(2000);
  });

  it("the dashboard refreshes a payout PayPal is still processing", async () => {
    const svc = await import("@/lib/orders/service");
    const { getDashboard } = await import("@/lib/dashboard/data");
    const { order, seller } = await sellerWithOrder(dbmod);
    await svc.shipOrder(order.id, { carrier: "DHL", trackingNumber: "1234567890" });
    const dash = await getDashboard(seller.id);
    expect(dash!.orders[0].payoutStatus).toBe("SUCCESS");
    expect(dash!.tiles.paidOut).toBe(171);
  });
});

describe.skipIf(!TEST_DB)("seller fixes their PayPal email", () => {
  it("failed payouts are sent again", async () => {
    process.env.DATABASE_URL = TEST_DB;
    const dbmod = await import("@/lib/db");
    const { sql, eq } = await import("drizzle-orm");
    await dbmod.db.execute(sql.raw(TRUNCATE_ALL));
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = new URL(url).pathname;
        calls.push(path);
        const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
        if (path === "/v1/oauth2/token") return json(200, { access_token: "tok", expires_in: 3600 });
        if (path === "/v1/payments/payouts" && init.method === "POST") return json(201, { batch_header: { payout_batch_id: "B-2", batch_status: "PENDING" } });
        return json(404, {});
      }),
    );
    const { seller, order } = await sellerWithOrder(dbmod, { order: { status: "CAPTURED", captureId: "CAP-1", payoutStatus: "FAILED", payoutError: "Receiver is invalid" } });
    const { retryFailedPayouts } = await import("@/lib/orders/payout");
    expect(await retryFailedPayouts(seller.id)).toBe(1);
    const [o] = await dbmod.db.select().from(dbmod.schema.orders).where(eq(dbmod.schema.orders.id, order.id));
    expect(o.payoutStatus).toBe("PENDING");
    vi.unstubAllGlobals();
  });
});
