/**
 * Runs the flow from INTEGRATION.md from start to finish, on real Postgres, with
 * a fake model and a fake PayPal. If this breaks, the guide needs updating too.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { buildTurnPrompt, type TranscriptEntry } from "../../eval/agents";
import { obedientModel } from "../../eval/fakes";
import {
  CircuitBreaker,
  createNegotiation,
  createSimulatedVerifier,
  decideRefund,
  emptyMetrics,
  freezeDeal,
  runGuardedTurn,
  verifyShipment,
  wrapUntrusted,
} from "../../index";
import {
  claimCapture,
  claimRefund,
  completeCapture,
  completeRefund,
  loadRefundContext,
  recordAuthorization,
  reserveOrder,
} from "../operations";

const url = process.env.TEST_DATABASE_URL;
const NOW = Date.now();
const DAY = 86_400_000;

describe.skipIf(!url)("integration guide flow", () => {
  const schema = `guardrails_guide_${randomBytes(4).toString("hex")}`;
  let pool: pg.Pool;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  it("goes from negotiation to a partial refund", async () => {
    await pool.query("INSERT INTO sellers (id, paypal_email) VALUES ('meera', 'meera@example.test')");
    await pool.query("INSERT INTO listings (id, seller_id, stock, refund_cap_minor) VALUES ('scarf', 'meera', 1, 1500)");
    await pool.query("INSERT INTO mandates (id, max_price_minor, currency) VALUES ('sarah', 9000, 'GBP')");
    await pool.query(
      "INSERT INTO negotiations (id, mandate_id, listing_id, status) VALUES ('neg_1', 'sarah', 'scarf', 'OPEN')",
    );

    // Step 4: run the negotiation.
    const breaker = new CircuitBreaker();
    const metrics = emptyMetrics();
    const history: TranscriptEntry[] = [];
    let state = createNegotiation({ listMinor: 10000, floorMinor: 6000, ceilingMinor: 9000, currency: "GBP" });
    while (["OPEN", "OFFERED", "COUNTERED"].includes(state.status)) {
      const actor = state.nextActor;
      const prompt = buildTurnPrompt(state, actor, history);
      const turn = await runGuardedTurn(obedientModel, state, actor, prompt, metrics, { breaker });
      state = turn.state;
      history.push({ actor, priceMinor: turn.event.finalMinor, message: turn.message });
    }
    expect(state.status).toBe("AGREED");
    const agreedMinor = state.agreedMinor!;

    // Step 6: freeze the deal.
    const deal = freezeDeal({
      negotiationId: "neg_1",
      mandateId: "sarah",
      listingId: "scarf",
      sellerId: "meera",
      payeeEmail: "meera@example.test",
      amountMinor: agreedMinor,
      currency: "GBP",
      shipToCountry: "GB",
      shipByMs: NOW + 3 * DAY,
      expiresAtMs: NOW + DAY,
    });
    await pool.query(
      `UPDATE negotiations
          SET status = 'AWAITING_BUYER_APPROVAL', agreed_minor = $2, frozen_deal = $3
        WHERE id = $1 AND status = 'OPEN'`,
      ["neg_1", deal.amountMinor, JSON.stringify(deal)],
    );

    // Step 7: Sarah approves.
    const paypal = {
      createOrder: vi.fn(async () => ({ id: "pp_order" })),
      authorize: vi.fn(async () => ({ authorizationId: "pp_auth" })),
      capture: vi.fn(async () => ({ captureId: "pp_capture" })),
      refund: vi.fn(async () => ({ refundId: "pp_refund" })),
    };
    const reserved = await reserveOrder(pool, { negotiationId: "neg_1", approvedHash: deal.hash, nowMs: NOW });
    if (reserved.outcome !== "reserved") throw new Error(`unexpected ${reserved.outcome}`);
    const created = await paypal.createOrder();
    const held = await paypal.authorize();
    await recordAuthorization(pool, {
      orderId: reserved.orderId,
      paypalOrderId: created.id,
      authorizationId: held.authorizationId,
    });

    // Step 8: Meera ships.
    const shipment = await verifyShipment(createSimulatedVerifier(), {
      carrier: "DHL",
      trackingNumber: "1234567890",
      shipToCountry: "GB",
    });
    if (shipment.verdict !== "ALLOW") throw new Error(shipment.rule);
    const capture = await claimCapture(pool, {
      orderId: reserved.orderId,
      carrier: "DHL",
      trackingNumber: "1234567890",
      enteredBy: "seller",
      shipment: shipment.value,
      nowMs: NOW,
    });
    if (capture.verdict !== "ALLOW") throw new Error(capture.rule);
    const captured = await paypal.capture();
    expect(await completeCapture(pool, reserved.orderId, captured.captureId)).toBe(true);

    // Step 9: Sarah reports a problem.
    const context = await loadRefundContext(pool, reserved.orderId);
    if (!context) throw new Error("order not found");
    expect(context.policy.refundCapMinor).toBe(1500);
    const outcome = await decideRefund(
      obedientModel,
      {
        system: "Propose a fair refund.",
        user: wrapUntrusted("buyer_complaint", "A thread has pulled near one edge."),
      },
      context.order,
      context.policy,
      { breaker },
    );
    if (outcome.outcome !== "refund") throw new Error(outcome.rule);
    const claim = await claimRefund(pool, {
      orderId: reserved.orderId,
      proposal: { amountMinor: outcome.proposedMinor, currency: "GBP", approvedBy: "agent" },
    });
    if (claim.verdict !== "ALLOW") throw new Error(claim.rule);
    const refunded = await paypal.refund();
    expect(await completeRefund(pool, claim.value.requestId, refunded.refundId)).toBe(true);

    const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [reserved.orderId]);
    expect(rows[0]).toMatchObject({
      status: "PARTIALLY_REFUNDED",
      amount_minor: agreedMinor,
      captured_minor: agreedMinor,
      refunded_total_minor: 1000,
      tracking_number: "1234567890",
      shipment_verified_by: "simulated",
    });
    const listing = await pool.query("SELECT stock FROM listings WHERE id = 'scarf'");
    expect(listing.rows[0].stock).toBe(0);
  });
});
