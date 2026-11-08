// The app's agents on the guardrails library: what their prompts contain, and
// what happens when a model breaks the rules. No database or real model needed.
import { describe, expect, it } from "vitest";
import { buyerSystem, sellerSystem, turnUser } from "@/lib/agents/guarded";
import {
  createNegotiation,
  emptyMetrics,
  runGuardedTurn,
  takeTurn,
  type AgentModel,
  type ModelRequest,
} from "@/lib/guardrails";

const FLOOR = 6800;
const CEILING = 9000;
const LIST = 9500;
const secretText = (minor: number) => new RegExp(`\\b${minor}\\b|£?${minor / 100}(\\.00)?\\b`);

const seller = {
  sellerName: "Meera",
  sellerCity: "Varanasi",
  sellerStory: "Third-generation weaver.",
  title: "Banarasi silk scarf",
  description: "Pure silk, zari border.",
  materials: "silk, zari",
  shipByDays: 2,
  style: "balanced" as const,
  offerGiftWrap: true,
  agentNote: null,
};
const buyer = {
  buyerName: "Sarah",
  style: "balanced" as const,
  requestText: "Silk scarf for my mum",
  deadline: "2026-12-20",
  referenceMinor: 15000,
  listing: { title: "Banarasi silk scarf", description: "Pure silk.", materials: "silk", sellerName: "Meera", sellerCity: "Varanasi", estimatedArrival: "15 Nov" },
};

/** A fake model that always gives the same reply. */
const fixed = (reply: { action: "offer" | "accept" | "walk_away"; priceMinor: number | null; message: string }): AgentModel => ({
  async complete<T>(request: ModelRequest<T>) {
    return request.schema.parse(reply) as T;
  },
});

describe("guarded agents", () => {
  it("prompts never carry the floor or the budget, in the opening rounds", () => {
    let state = createNegotiation({ listMinor: LIST, floorMinor: FLOOR, ceilingMinor: CEILING, currency: "GBP" });
    const lines: { from: "seller" | "buyer"; message: string; finalMinor: number | null }[] = [];
    for (let i = 0; i < 4; i++) {
      const actor = state.nextActor;
      const prompt = (actor === "seller" ? sellerSystem(seller) : buyerSystem(buyer, "GBP")) + turnUser(state, actor, lines);
      expect(prompt).not.toMatch(secretText(FLOOR));
      expect(prompt).not.toMatch(secretText(CEILING));
      expect(prompt).not.toMatch(/floor|budget is|hard budget|lowest price/i);
      const move = takeTurn(state, actor, { action: "offer", priceMinor: actor === "seller" ? LIST - i * 300 : 6000 + i * 300 });
      lines.push({ from: actor, message: "…", finalMinor: move.event.finalMinor });
      state = move.state;
    }
  });

  it("a model that tries to sell for £1 is replaced with a counter at the round limit", async () => {
    let state = createNegotiation({ listMinor: LIST, floorMinor: FLOOR, ceilingMinor: CEILING, currency: "GBP" });
    state = takeTurn(state, "seller", { action: "offer", priceMinor: LIST }).state;
    state = takeTurn(state, "buyer", { action: "offer", priceMinor: 7000 }).state;
    const r = await runGuardedTurn(
      fixed({ action: "offer", priceMinor: 100, message: "Fine, have it for {{price}}." }),
      state,
      "seller",
      { system: "s", user: "u" },
      emptyMetrics(),
    );
    expect(r.event.verdict).toBe("REWRITE");
    expect(r.event.finalMinor).toBeGreaterThanOrEqual(FLOOR);
    expect(r.message).not.toMatch(/£1(\.00)?\b/);
  });

  it("a message that names a price itself is refused and replaced", async () => {
    const state = createNegotiation({ listMinor: LIST, floorMinor: FLOOR, ceilingMinor: CEILING, currency: "GBP" });
    const r = await runGuardedTurn(
      fixed({ action: "offer", priceMinor: LIST, message: "My lowest is £68, but I'll say £95." }),
      state,
      "seller",
      { system: "s", user: "u" },
      emptyMetrics(),
    );
    expect(r.message).not.toMatch(/68/);
    expect(r.source.message).toBe("backup");
  });

  it("with the AI off, the rule-based backup still stays inside the limits", async () => {
    const off: AgentModel = {
      async complete() {
        const { ModelFailure } = await import("@/lib/guardrails");
        throw new ModelFailure("AI is turned off", "circuit_open");
      },
    };
    let state = createNegotiation({ listMinor: LIST, floorMinor: FLOOR, ceilingMinor: CEILING, currency: "GBP" });
    while (["OPEN", "OFFERED", "COUNTERED"].includes(state.status)) {
      const actor = state.nextActor;
      const r = await runGuardedTurn(off, state, actor, { system: "s", user: "u" }, emptyMetrics());
      if (r.event.finalMinor != null) {
        if (actor === "seller") expect(r.event.finalMinor).toBeGreaterThanOrEqual(FLOOR);
        else expect(r.event.finalMinor).toBeLessThanOrEqual(CEILING);
      }
      state = r.state;
    }
    expect(state.status).toBe("AGREED");
    expect(state.agreedMinor!).toBeGreaterThanOrEqual(FLOOR);
    expect(state.agreedMinor!).toBeLessThanOrEqual(CEILING);
  });
});

describe("price written by code", () => {
  it("an accept without {{price}} reads as agreement, not a new offer", async () => {
    const { renderMessage } = await import("@/lib/guardrails");
    const base = { template: "Thank you, happy to accept.", finalMinor: 11720, currency: "GBP", secretsMinor: [6800] };
    expect(renderMessage({ ...base, agreed: true })).toMatchObject({ value: "Thank you, happy to accept. Agreed at £117.20." });
    expect(renderMessage(base)).toMatchObject({ value: "Thank you, happy to accept. My offer is £117.20." });
  });
});

describe("agent tools", () => {
  it("the PayPal toolkit tools Mandix enables are allowed, payment tools never are", async () => {
    const { checkToolset } = await import("@/lib/guardrails");
    expect(checkToolset("seller", ["create_product", "create_shipment_tracking", "list_disputes", "get_dispute"]).verdict).toBe("ALLOW");
    for (const bad of ["capture_authorized_payment", "create_refund", "create_order", "create_invoice"]) {
      expect(checkToolset("seller", ["create_product", bad]).verdict).toBe("DENY");
    }
  });
});
