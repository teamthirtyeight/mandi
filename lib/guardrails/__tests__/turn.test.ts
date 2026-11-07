import { describe, expect, it, vi } from "vitest";
import { parseReply } from "../eval/claude";
import { compromisedModel, failingModel, garbageModel, hangingModel, obedientModel } from "../eval/fakes";
import type { OrderRecord } from "../money";
import { createNegotiation, rankDeals } from "../negotiation";
import {
  CircuitBreaker,
  ModelFailure,
  NEUTRAL_MATCH_QUALITY,
  TurnOutput,
  decideRefund,
  emptyMetrics,
  guardedCall,
  runGuardedTurn,
  scoreListings,
  type AgentModel,
  type FailureKind,
} from "../turn";

const failsWith = (kind: FailureKind): AgentModel => ({
  async complete() {
    throw new ModelFailure(`simulated ${kind}`, kind);
  },
});

const request = { kind: "turn" as const, system: "s", user: "u", schema: TurnOutput };
const prompt = { system: "s", user: '{"yourLimitThisRoundMinor":10000}' };
const negotiation = () =>
  createNegotiation({ floorMinor: 6000, ceilingMinor: 9000, listMinor: 10000, currency: "GBP" });

describe("guardedCall", () => {
  it("stops waiting and signals the model at the time limit", async () => {
    let signal: AbortSignal | undefined;
    const model: AgentModel = {
      complete(req) {
        signal = req.signal;
        return new Promise(() => undefined);
      },
    };
    await expect(guardedCall(model, request, { timeoutMs: 5 })).rejects.toMatchObject({ kind: "timeout" });
    expect(signal?.aborted).toBe(true);
  });

  it("ignores a late failure after the time limit", async () => {
    const model: AgentModel = {
      complete: () => new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 15)),
    };
    await expect(guardedCall(model, request, { timeoutMs: 1 })).rejects.toMatchObject({ kind: "timeout" });
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  it("passes real faults through without treating them as outages", async () => {
    const breaker = new CircuitBreaker(1);
    const broken: AgentModel = {
      complete: () => Promise.reject(new Error("invalid API key")),
    };
    await expect(guardedCall(broken, request, { breaker })).rejects.toThrow("invalid API key");
    expect(breaker.allowsCall()).toBe(true);
  });
});

describe("CircuitBreaker", () => {
  it("opens after repeated outages, then allows a trial after the cooldown", () => {
    let now = 0;
    const breaker = new CircuitBreaker(3, 1000, () => now);
    breaker.recordOutage();
    breaker.recordOutage();
    expect(breaker.allowsCall()).toBe(true);
    breaker.recordOutage();
    expect(breaker.allowsCall()).toBe(false);
    now = 1000;
    expect(breaker.allowsCall()).toBe(true);
    breaker.recordOutage();
    expect(breaker.allowsCall()).toBe(false);
  });

  it("resets when the service responds", () => {
    const breaker = new CircuitBreaker(2);
    breaker.recordOutage();
    breaker.recordResponse();
    breaker.recordOutage();
    expect(breaker.allowsCall()).toBe(true);
  });

  it.each(["outage", "timeout"] as const)("counts a %s", async (kind) => {
    const breaker = new CircuitBreaker(1);
    await expect(guardedCall(failsWith(kind), request, { breaker })).rejects.toThrow();
    expect(breaker.allowsCall()).toBe(false);
  });

  it("can't be tripped by refusals or bad output", async () => {
    const breaker = new CircuitBreaker(1);
    for (let i = 0; i < 5; i++) {
      await expect(guardedCall(failsWith("bad_output"), request, { breaker })).rejects.toThrow();
    }
    expect(breaker.allowsCall()).toBe(true);
  });

  it("skips the model entirely while open", async () => {
    const breaker = new CircuitBreaker(1);
    breaker.recordOutage();
    const complete = vi.fn();
    await expect(guardedCall({ complete }, request, { breaker })).rejects.toMatchObject({ kind: "circuit_open" });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("runGuardedTurn", () => {
  it("marks a normal turn as fully AI-made", async () => {
    const result = await runGuardedTurn(obedientModel, negotiation(), "seller", prompt, emptyMetrics());
    expect(result.source).toEqual({ action: "model", message: "model", reason: null });
    expect(result.message).toContain("£100.00");
  });

  it("finishes a hanging turn using backup rules and reports why", async () => {
    const metrics = emptyMetrics();
    const result = await runGuardedTurn(hangingModel, negotiation(), "seller", prompt, metrics, {
      timeoutMs: 5,
      turnBudgetMs: 50,
    });
    expect(result.source).toEqual({ action: "rules", message: "backup", reason: "timeout" });
    expect(result.event.finalMinor).toBe(10000);
    expect(metrics.backupReasons).toEqual({ timeout: 1 });
  });

  it("stops retrying once the turn budget is used up", async () => {
    const complete = vi.fn(() => new Promise(() => undefined)) as unknown as AgentModel["complete"];
    const result = await runGuardedTurn({ complete }, negotiation(), "seller", prompt, emptyMetrics(), {
      timeoutMs: 30,
      turnBudgetMs: 30,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.source.reason).toBe("turn_budget");
  });

  it("uses rules at once when the service is known to be down", async () => {
    const breaker = new CircuitBreaker(1);
    breaker.recordOutage();
    const complete = vi.fn() as unknown as AgentModel["complete"];
    const metrics = emptyMetrics();
    const result = await runGuardedTurn({ complete }, negotiation(), "seller", prompt, metrics, { breaker });
    expect(complete).not.toHaveBeenCalled();
    expect(result.source.reason).toBe("circuit_open");
    expect(metrics.modelFailures).toBe(0);
  });

  it("reports invalid prices as a rejected offer", async () => {
    const result = await runGuardedTurn(garbageModel, negotiation(), "seller", prompt, emptyMetrics());
    expect(result.source).toEqual({ action: "rules", message: "backup", reason: "rejected_offer" });
  });

  it("keeps the action but replaces a leaking message", async () => {
    const result = await runGuardedTurn(compromisedModel, negotiation(), "seller", prompt, emptyMetrics());
    expect(result.source).toEqual({ action: "model", message: "backup", reason: "rejected_message" });
    expect(result.message).toBe("I can do £100.00.");
  });

  it("treats a bad reply from the real model code as a failed turn", async () => {
    const model: AgentModel = {
      async complete(req) {
        return parseReply("not json", req.schema);
      },
    };
    const result = await runGuardedTurn(model, negotiation(), "seller", prompt, emptyMetrics());
    expect(result.source).toEqual({ action: "rules", message: "backup", reason: "bad_output" });
  });

  it("doesn't hide real faults behind backup rules", async () => {
    const broken: AgentModel = { complete: () => Promise.reject(new Error("invalid API key")) };
    await expect(runGuardedTurn(broken, negotiation(), "seller", prompt, emptyMetrics())).rejects.toThrow(
      "invalid API key",
    );
  });
});

describe("decideRefund", () => {
  const order: OrderRecord = {
    id: "ord_1",
    amountMinor: 7200,
    currency: "GBP",
    status: "CAPTURED",
    authorizationId: "auth_1",
    captureId: "cap_1",
    capturedMinor: 7200,
    refundedTotalMinor: 0,
    refundCount: 0,
    autoRefundCount: 0,
    shipByMs: 0,
  };
  const policy = { refundCapMinor: 1500, maxAutoRefundsPerOrder: 1 };
  const refundPrompt = { system: "s", user: "u" };
  const proposing = (refundMinor: number): AgentModel => ({
    async complete(req) {
      return req.schema.parse({ refundMinor, message: "Sorry." });
    },
  });

  it("refunds automatically within the cap", async () => {
    const result = await decideRefund(proposing(1000), refundPrompt, order, policy);
    expect(result.outcome).toBe("refund");
    if (result.outcome === "refund") expect(result.params.requestId).toBe("refund-cap_1-1");
  });

  it.each([
    ["a failed model", failingModel, "MODEL_FAILED"],
    ["an amount above the cap", proposing(7200), "OVER_REFUND_CAP"],
    ["no refund proposed", proposing(0), "NO_USABLE_PROPOSAL"],
    ["a negative amount", proposing(-500), "NO_USABLE_PROPOSAL"],
    ["a fractional amount", proposing(10.5), "NO_USABLE_PROPOSAL"],
    ["more than was paid", proposing(9000), "OVER_CAPTURED"],
  ])("asks the seller after %s", async (_name, model, rule) => {
    const result = await decideRefund(model, refundPrompt, order, policy);
    expect(result.outcome).toBe("ask_seller");
    expect(result.rule).toBe(rule);
  });

  it("asks the seller when the model hangs", async () => {
    const result = await decideRefund(hangingModel, refundPrompt, order, policy, { timeoutMs: 5 });
    expect(result).toMatchObject({ outcome: "ask_seller", failure: "timeout" });
  });

  it("rejects when the order can't be refunded at all", async () => {
    const result = await decideRefund(proposing(1000), refundPrompt, { ...order, status: "REFUNDED" }, policy);
    expect(result.outcome).toBe("rejected");
  });
});

describe("scoreListings", () => {
  const rerankPrompt = { system: "s", user: "u" };
  const scoring = (scores: { id: string; matchQuality: number }[]): AgentModel => ({
    async complete(req) {
      return req.schema.parse({ scores });
    },
  });

  it("uses the model's scores when they are complete", async () => {
    const result = await scoreListings(
      scoring([
        { id: "a", matchQuality: 0.9 },
        { id: "b", matchQuality: 0.2 },
      ]),
      rerankPrompt,
      ["a", "b"],
    );
    expect(result).toEqual({ scores: { a: 0.9, b: 0.2 }, usedBackup: false });
  });

  it.each([
    ["fails", failingModel],
    ["returns nothing useful", scoring([])],
  ])("gives all listings a neutral score when the model %s", async (_name, model) => {
    const result = await scoreListings(model, rerankPrompt, ["a", "b"]);
    expect(result.scores).toEqual({ a: NEUTRAL_MATCH_QUALITY, b: NEUTRAL_MATCH_QUALITY });
    expect(result.usedBackup).toBe(true);
  });

  it("gives a skipped listing a neutral score and ignores unknown IDs", async () => {
    const result = await scoreListings(
      scoring([
        { id: "a", matchQuality: 0.9 },
        { id: "invented", matchQuality: 1 },
      ]),
      rerankPrompt,
      ["a", "b"],
    );
    expect(result.scores).toEqual({ a: 0.9, b: NEUTRAL_MATCH_QUALITY });
    expect(result.usedBackup).toBe(true);
  });

  it("lets price decide when neutral scores are used", async () => {
    const { scores } = await scoreListings(failingModel, rerankPrompt, ["pricey", "cheap"]);
    const shared = { referenceMinor: 10000, deliveryMs: 0, deadlineMs: 1 };
    const ranked = rankDeals([
      { ...shared, negotiationId: "pricey", agreedMinor: 9000, matchQuality: scores.pricey ?? 0 },
      { ...shared, negotiationId: "cheap", agreedMinor: 7000, matchQuality: scores.cheap ?? 0 },
    ]);
    expect(ranked[0]?.deal.negotiationId).toBe("cheap");
  });
});
