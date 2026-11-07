/**
 * Fires simultaneous requests at real Postgres. Skipped unless TEST_DATABASE_URL
 * is set, which `npm run test:db` does. Runs in its own temporary schema.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { freezeDeal } from "../../money";
import type { ConfirmedShipment } from "../../shipment";
import {
  claimCapture,
  claimRefund,
  completeCapture,
  completeRefund,
  recordAuthorization,
  releaseCapture,
  releaseRefund,
  releaseReservation,
  reserveOrder,
} from "../operations";

const url = process.env.TEST_DATABASE_URL;
const NOW = Date.now();
const DAY = 86_400_000;
const shipment: ConfirmedShipment = { status: "confirmed", source: "simulated", destinationCountry: "GB" };

let serial = 0;
const unique = (prefix: string) => `${prefix}_${++serial}_${randomBytes(3).toString("hex")}`;
/** A valid DHL number that's different each time. */
const trackingNumber = () => String(1_000_000_000 + ++serial * 7919);

describe.skipIf(!url)("database safety under simultaneous requests", () => {
  const schema = `guardrails_test_${randomBytes(4).toString("hex")}`;
  let pool: pg.Pool;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({
      connectionString: url,
      max: 25,
      options: `-c search_path=${schema}`,
    });
    await pool.query(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  const seedListing = async (stock: number, refundCapMinor: number | null = 1500) => {
    const sellerId = unique("seller");
    const listingId = unique("listing");
    const paypalEmail = `${sellerId}@example.test`;
    await pool.query("INSERT INTO sellers (id, paypal_email) VALUES ($1, $2)", [sellerId, paypalEmail]);
    await pool.query("INSERT INTO listings (id, seller_id, stock, refund_cap_minor) VALUES ($1, $2, $3, $4)", [
      listingId,
      sellerId,
      stock,
      refundCapMinor,
    ]);
    return { sellerId, listingId, paypalEmail };
  };

  const seedDeal = async (seller: Awaited<ReturnType<typeof seedListing>>, amountMinor = 7200) => {
    const mandateId = unique("mandate");
    const negotiationId = unique("neg");
    await pool.query("INSERT INTO mandates (id, max_price_minor, currency) VALUES ($1, 9000, 'GBP')", [mandateId]);
    const deal = freezeDeal({
      negotiationId,
      mandateId,
      listingId: seller.listingId,
      sellerId: seller.sellerId,
      payeeEmail: seller.paypalEmail,
      amountMinor,
      currency: "GBP",
      shipToCountry: "GB",
      shipByMs: NOW + 3 * DAY,
      expiresAtMs: NOW + DAY,
    });
    await pool.query(
      `INSERT INTO negotiations (id, mandate_id, listing_id, status, agreed_minor, frozen_deal)
       VALUES ($1, $2, $3, 'AWAITING_BUYER_APPROVAL', $4, $5)`,
      [negotiationId, mandateId, seller.listingId, amountMinor, JSON.stringify(deal)],
    );
    return deal;
  };

  const stockOf = async (listingId: string) =>
    (await pool.query<{ stock: number }>("SELECT stock FROM listings WHERE id = $1", [listingId])).rows[0]?.stock;

  const orderRow = async (orderId: string) =>
    (await pool.query("SELECT * FROM orders WHERE id = $1", [orderId])).rows[0];

  const authorizedOrder = async (refundCapMinor: number | null = 1500) => {
    const seller = await seedListing(1, refundCapMinor);
    const deal = await seedDeal(seller);
    const reserved = await reserveOrder(pool, {
      negotiationId: deal.negotiationId,
      approvedHash: deal.hash,
      nowMs: NOW,
    });
    if (reserved.outcome !== "reserved") throw new Error("expected a reservation");
    await recordAuthorization(pool, {
      orderId: reserved.orderId,
      paypalOrderId: `pp_${reserved.orderId}`,
      authorizationId: `auth_${reserved.orderId}`,
    });
    return reserved.orderId;
  };

  const capturedOrder = async (refundCapMinor: number | null = 1500) => {
    const orderId = await authorizedOrder(refundCapMinor);
    const claim = await claimCapture(pool, {
      orderId,
      carrier: "DHL",
      trackingNumber: trackingNumber(),
      enteredBy: "seller",
      shipment,
      nowMs: NOW,
    });
    if (claim.verdict !== "ALLOW") throw new Error(`capture claim failed: ${claim.rule}`);
    await completeCapture(pool, orderId, `cap_${orderId}`);
    return orderId;
  };

  describe("the test really creates simultaneous requests", () => {
    it("oversells with an unsafe check-then-update", async () => {
      const { listingId } = await seedListing(1);
      await pool.query("ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_stock_check");
      try {
        const unsafeBuy = async () => {
          const { rows } = await pool.query<{ stock: number }>("SELECT stock FROM listings WHERE id = $1", [listingId]);
          if ((rows[0]?.stock ?? 0) < 1) return false;
          await pool.query("SELECT pg_sleep(0.05)");
          await pool.query("UPDATE listings SET stock = stock - 1 WHERE id = $1", [listingId]);
          return true;
        };
        const sold = (await Promise.all(Array.from({ length: 10 }, unsafeBuy))).filter(Boolean).length;
        expect(sold).toBeGreaterThan(1);
      } finally {
        await pool.query("UPDATE listings SET stock = 0 WHERE id = $1", [listingId]);
        await pool.query("ALTER TABLE listings ADD CONSTRAINT listings_stock_check CHECK (stock >= 0)");
      }
    });
  });

  describe("buying", () => {
    it("sells the last item once when 10 buyers approve at the same moment", async () => {
      const seller = await seedListing(1);
      const deals = await Promise.all(Array.from({ length: 10 }, () => seedDeal(seller)));
      const results = await Promise.all(
        deals.map((deal) =>
          reserveOrder(pool, { negotiationId: deal.negotiationId, approvedHash: deal.hash, nowMs: NOW }),
        ),
      );
      const reserved = results.filter((result) => result.outcome === "reserved");
      const soldOut = results.filter(
        (result) => result.outcome === "denied" && result.decision.rule === "OUT_OF_STOCK",
      );
      expect(reserved).toHaveLength(1);
      expect(soldOut).toHaveLength(9);
      expect(await stockOf(seller.listingId)).toBe(0);
    });

    it("sells exactly the available stock under heavier load", async () => {
      const seller = await seedListing(3);
      const deals = await Promise.all(Array.from({ length: 20 }, () => seedDeal(seller)));
      const results = await Promise.all(
        deals.map((deal) =>
          reserveOrder(pool, { negotiationId: deal.negotiationId, approvedHash: deal.hash, nowMs: NOW }),
        ),
      );
      expect(results.filter((result) => result.outcome === "reserved")).toHaveLength(3);
      expect(await stockOf(seller.listingId)).toBe(0);
    });

    it("creates one order from 10 simultaneous clicks on Approve", async () => {
      const seller = await seedListing(5);
      const deal = await seedDeal(seller);
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          reserveOrder(pool, { negotiationId: deal.negotiationId, approvedHash: deal.hash, nowMs: NOW }),
        ),
      );
      expect(results.filter((result) => result.outcome === "reserved")).toHaveLength(1);
      expect(results.filter((result) => result.outcome === "existing")).toHaveLength(9);
      const ids = new Set(results.flatMap((result) => (result.outcome === "denied" ? [] : [result.params.requestId])));
      expect(ids.size).toBe(1);
      expect(await stockOf(seller.listingId)).toBe(4);
      const { rows } = await pool.query("SELECT id FROM orders WHERE negotiation_id = $1", [deal.negotiationId]);
      expect(rows).toHaveLength(1);
    });

    it("rejects an approval for different terms", async () => {
      const seller = await seedListing(1);
      const deal = await seedDeal(seller);
      const result = await reserveOrder(pool, { negotiationId: deal.negotiationId, approvedHash: "other", nowMs: NOW });
      expect(result).toMatchObject({ outcome: "denied", decision: { rule: "APPROVAL_MISMATCH" } });
      expect(await stockOf(seller.listingId)).toBe(1);
    });

    it("gives stock back once, however many times release is called", async () => {
      const seller = await seedListing(1);
      const deal = await seedDeal(seller);
      const reserved = await reserveOrder(pool, {
        negotiationId: deal.negotiationId,
        approvedHash: deal.hash,
        nowMs: NOW,
      });
      if (reserved.outcome !== "reserved") throw new Error("expected a reservation");
      const released = await Promise.all(Array.from({ length: 5 }, () => releaseReservation(pool, reserved.orderId)));
      expect(released.filter(Boolean)).toHaveLength(1);
      expect(await stockOf(seller.listingId)).toBe(1);

      const again = await reserveOrder(pool, {
        negotiationId: deal.negotiationId,
        approvedHash: deal.hash,
        nowMs: NOW,
      });
      expect(again.outcome).toBe("reserved");
    });

    it("won't release stock once the buyer has authorized payment", async () => {
      const orderId = await authorizedOrder();
      expect(await releaseReservation(pool, orderId)).toBe(false);
      expect((await orderRow(orderId)).status).toBe("AUTHORIZED");
    });
  });

  describe("capturing", () => {
    const claim = (orderId: string, number: string, nowMs = NOW) =>
      claimCapture(pool, { orderId, carrier: "DHL", trackingNumber: number, enteredBy: "seller", shipment, nowMs });

    it("lets one of 10 simultaneous requests capture", async () => {
      const orderId = await authorizedOrder();
      const number = trackingNumber();
      const results = await Promise.all(Array.from({ length: 10 }, () => claim(orderId, number)));
      expect(results.filter((result) => result.verdict === "ALLOW")).toHaveLength(1);
      expect(results.filter((result) => result.rule === "CAPTURE_IN_PROGRESS")).toHaveLength(9);
    });

    it("won't let two orders use one tracking number at the same moment", async () => {
      const orders = await Promise.all(Array.from({ length: 6 }, () => authorizedOrder()));
      const number = trackingNumber();
      const results = await Promise.all(orders.map((orderId) => claim(orderId, number)));
      expect(results.filter((result) => result.verdict === "ALLOW")).toHaveLength(1);
      expect(results.filter((result) => result.rule === "TRACKING_REUSED")).toHaveLength(5);
    });

    it("records whether the shipment check was simulated", async () => {
      const orderId = await authorizedOrder();
      await claim(orderId, trackingNumber());
      expect((await orderRow(orderId)).shipment_verified_by).toBe("simulated");
    });

    it("needs the seller's tracking entry and leaves the order untouched otherwise", async () => {
      const orderId = await authorizedOrder();
      const result = await claimCapture(pool, {
        orderId,
        carrier: "DHL",
        trackingNumber: trackingNumber(),
        enteredBy: "agent",
        shipment,
        nowMs: NOW,
      });
      expect(result.rule).toBe("TRACKING_NEEDS_SELLER");
      expect((await orderRow(orderId)).status).toBe("AUTHORIZED");
    });

    it("allows a retry with the same request ID after a decline or an expired lease", async () => {
      const orderId = await authorizedOrder();
      const number = trackingNumber();
      const first = await claim(orderId, number);
      await releaseCapture(pool, orderId);
      const afterDecline = await claim(orderId, number);
      const blocked = await claim(orderId, number);
      const afterExpiry = await claim(orderId, number, NOW + 61_000);
      expect(blocked.rule).toBe("CAPTURE_IN_PROGRESS");
      for (const result of [first, afterDecline, afterExpiry]) {
        expect(result.verdict).toBe("ALLOW");
        if (result.verdict === "ALLOW") expect(result.value.requestId).toBe(`capture-auth_${orderId}`);
      }
    });

    it("won't accept a different tracking number on a retry", async () => {
      const orderId = await authorizedOrder();
      await claim(orderId, trackingNumber());
      await releaseCapture(pool, orderId);
      expect((await claim(orderId, trackingNumber())).rule).toBe("TRACKING_CHANGED");
    });

    it("won't capture a finished order", async () => {
      const orderId = await capturedOrder();
      expect((await claim(orderId, trackingNumber())).rule).toBe("NOT_CAPTURABLE");
    });
  });

  describe("refunding", () => {
    const refund = (orderId: string, amountMinor: number, approvedBy: "agent" | "seller", maxAuto?: number) =>
      claimRefund(pool, {
        orderId,
        proposal: { amountMinor, currency: "GBP", approvedBy },
        ...(maxAuto === undefined ? {} : { maxAutoRefundsPerOrder: maxAuto }),
      });

    it("allows one automatic refund from 5 simultaneous agent requests", async () => {
      const orderId = await capturedOrder();
      // Small enough that the cap isn't what stops the later requests.
      const results = await Promise.all(Array.from({ length: 5 }, () => refund(orderId, 500, "agent")));
      expect(results.filter((result) => result.verdict === "ALLOW")).toHaveLength(1);
      expect(results.filter((result) => result.rule === "AUTO_REFUND_LIMIT")).toHaveLength(4);
      expect((await orderRow(orderId)).refunded_total_minor).toBe(500);
    });

    it("keeps simultaneous agent refunds within the cap", async () => {
      const orderId = await capturedOrder(1500);
      const results = await Promise.all(Array.from({ length: 5 }, () => refund(orderId, 500, "agent", 5)));
      expect(results.filter((result) => result.verdict === "ALLOW")).toHaveLength(3);
      expect(results.filter((result) => result.rule === "OVER_REFUND_CAP")).toHaveLength(2);
      expect((await orderRow(orderId)).refunded_total_minor).toBe(1500);
    });

    it("keeps simultaneous seller refunds within the captured amount", async () => {
      const orderId = await capturedOrder();
      const results = await Promise.all(Array.from({ length: 5 }, () => refund(orderId, 3000, "seller")));
      expect(results.filter((result) => result.verdict === "ALLOW")).toHaveLength(2);
      expect(results.filter((result) => result.rule === "OVER_CAPTURED")).toHaveLength(3);
      const row = await orderRow(orderId);
      expect(row.refunded_total_minor).toBe(6000);
      expect(row.status).toBe("PARTIALLY_REFUNDED");
    });

    it("gives every refund its own request ID", async () => {
      const orderId = await capturedOrder();
      const results = await Promise.all(Array.from({ length: 4 }, () => refund(orderId, 1000, "seller")));
      const ids = results.flatMap((result) => (result.verdict === "ALLOW" ? [result.value.requestId] : []));
      expect(new Set(ids).size).toBe(4);
    });

    it("marks a complete refund as REFUNDED", async () => {
      const orderId = await capturedOrder();
      const result = await refund(orderId, 7200, "seller");
      expect(result.verdict).toBe("ALLOW");
      expect((await orderRow(orderId)).status).toBe("REFUNDED");
    });

    it("always asks the seller when no cap is set", async () => {
      const orderId = await capturedOrder(null);
      expect((await refund(orderId, 1, "agent")).rule).toBe("NO_REFUND_CAP");
    });

    it("restores the cap once after PayPal rejects a refund, and doesn't reuse its ID", async () => {
      const orderId = await capturedOrder(1500);
      const first = await refund(orderId, 1000, "agent");
      if (first.verdict !== "ALLOW") throw new Error("expected ALLOW");
      const released = await Promise.all(Array.from({ length: 5 }, () => releaseRefund(pool, first.value.requestId)));
      expect(released.filter(Boolean)).toHaveLength(1);
      const row = await orderRow(orderId);
      expect(row.refunded_total_minor).toBe(0);
      expect(row.status).toBe("CAPTURED");

      const second = await refund(orderId, 1000, "agent");
      expect(second.verdict).toBe("ALLOW");
      if (second.verdict === "ALLOW") expect(second.value.requestId).not.toBe(first.value.requestId);
    });

    it("won't release a completed refund", async () => {
      const orderId = await capturedOrder();
      const result = await refund(orderId, 1000, "agent");
      if (result.verdict !== "ALLOW") throw new Error("expected ALLOW");
      expect(await completeRefund(pool, result.value.requestId, "pp_refund")).toBe(true);
      expect(await releaseRefund(pool, result.value.requestId)).toBe(false);
      expect((await orderRow(orderId)).refunded_total_minor).toBe(1000);
    });
  });

  describe("last line of defence", () => {
    it("rejects bad data written directly, even if application code has a bug", async () => {
      const orderId = await capturedOrder();
      await expect(pool.query("UPDATE orders SET refunded_total_minor = 999999 WHERE id = $1", [orderId])).rejects.toThrow(
        /check/i,
      );
      const { listingId } = await seedListing(0);
      await expect(pool.query("UPDATE listings SET stock = -1 WHERE id = $1", [listingId])).rejects.toThrow(/check/i);
    });
  });
});
