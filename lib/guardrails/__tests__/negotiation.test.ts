import { describe, expect, it } from "vitest";
import {
  agentBrief,
  counterpartyView,
  createNegotiation,
  evaluateTurn,
  isDeliverable,
  rankDeals,
  roundLimit,
  ruleBasedTurn,
  takeTurn,
  type NegotiationState,
} from "../negotiation";

const setup = (overrides = {}) =>
  createNegotiation({
    floorMinor: 6000,
    ceilingMinor: 9000,
    listMinor: 10000,
    currency: "GBP",
    ...overrides,
  });

const play = (state: NegotiationState, seller: number, buyer: number) => {
  const afterSeller = takeTurn(state, "seller", { action: "offer", priceMinor: seller }).state;
  return takeTurn(afterSeller, "buyer", { action: "offer", priceMinor: buyer }).state;
};

describe("creating a negotiation", () => {
  it("rejects a floor above the list price and non-integer money", () => {
    expect(() => setup({ floorMinor: 11000 })).toThrow();
    expect(() => setup({ listMinor: 100.5 })).toThrow();
  });
});

describe("round limits", () => {
  it("makes the seller open at list price", () => {
    const { decision, state } = takeTurn(setup(), "seller", { action: "offer", priceMinor: 8000 });
    expect(decision.verdict).toBe("REWRITE");
    expect(decision.rule).toBe("SELLER_OPENS_AT_LIST");
    expect(state.sellerLastMinor).toBe(10000);
  });

  it("shrinks concession steps as the negotiation continues", () => {
    let state = setup();
    const asks: number[] = [];
    for (let i = 0; i < 4; i++) {
      const limit = roundLimit(state, "seller");
      asks.push(limit);
      state = takeTurn(state, "seller", { action: "offer", priceMinor: limit }).state;
      state = takeTurn(state, "buyer", { action: "offer", priceMinor: 1000 + i }).state;
    }
    const steps = asks.slice(1).map((ask, i) => asks[i]! - ask);
    expect(steps[0]!).toBeGreaterThan(steps[1]!);
    expect(steps[1]!).toBeGreaterThan(steps[2]!);
  });

  const toFinalRound = (overrides = {}) => {
    let state = setup({ maxRounds: 2, ...overrides });
    state = play(state, state.limits.listMinor, 1000);
    expect(state.round).toBe(2);
    return state;
  };

  it("lets both sides meet at the midpoint in the final round, not at their real limits", () => {
    const state = toFinalRound();
    expect(roundLimit(state, "seller")).toBe(7500);
    const { state: afterSeller } = takeTurn(state, "seller", { action: "offer", priceMinor: 7500 });
    expect(roundLimit(afterSeller, "buyer")).toBe(7500);
    const { state: done } = takeTurn(afterSeller, "buyer", { action: "accept" });
    expect(done.agreedMinor).toBe(7500);
  });

  it("lets the buyer take an affordable ask above the midpoint in the final round", () => {
    const { state } = takeTurn(toFinalRound(), "seller", { action: "offer", priceMinor: 8800 });
    const { state: done } = takeTurn(state, "buyer", { action: "accept" });
    expect(done.agreedMinor).toBe(8800);
  });

  it("won't let the buyer take an ask above the ceiling in the final round", () => {
    const { state } = takeTurn(toFinalRound(), "seller", { action: "offer", priceMinor: 9500 });
    const { decision, event } = takeTurn(state, "buyer", { action: "accept" });
    expect(decision.rule).toBe("ACCEPT_OUTSIDE_LIMIT");
    expect(event.finalMinor).toBe(7500);
  });

  it("never reaches the real limits in the final round when no deal is possible", () => {
    const state = toFinalRound({ floorMinor: 9500, ceilingMinor: 9000, listMinor: 12000 });
    expect(roundLimit(state, "seller")).toBeGreaterThan(9500);
    const { state: afterSeller } = takeTurn(state, "seller", {
      action: "offer",
      priceMinor: roundLimit(state, "seller"),
    });
    expect(roundLimit(afterSeller, "buyer")).toBeLessThan(9000);
  });

  it("still closes a deal when the overlap is tiny", () => {
    const state = toFinalRound({ floorMinor: 8999, ceilingMinor: 9000 });
    const { state: afterSeller } = takeTurn(state, "seller", ruleBasedTurn(state, "seller"));
    const { state: done } = takeTurn(afterSeller, "buyer", ruleBasedTurn(afterSeller, "buyer"));
    expect(done.status).toBe("AGREED");
    expect(done.agreedMinor).toBeGreaterThanOrEqual(8999);
    expect(done.agreedMinor).toBeLessThanOrEqual(9000);
  });

  it("never gives an agent the floor or ceiling mid-negotiation", () => {
    const state = play(setup(), 10000, 5000);
    const text = JSON.stringify([agentBrief(state, "seller"), agentBrief(state, "buyer")]);
    expect(text).not.toContain("6000");
    expect(text).not.toContain("9000");
    expect(text).not.toMatch(/floor|ceiling/i);
  });
});

describe("turn rules", () => {
  it("rewrites offers past the limit to a counter that isn't the limit itself", () => {
    const state = takeTurn(setup(), "seller", { action: "offer", priceMinor: 10000 }).state;
    const afterBuyer = takeTurn(state, "buyer", { action: "offer", priceMinor: 5000 }).state;
    const { decision, event } = takeTurn(afterBuyer, "seller", { action: "offer", priceMinor: 100 });
    expect(decision.verdict).toBe("REWRITE");
    expect(event.proposedMinor).toBe(100);
    expect(event.finalMinor).toBe(8400);
  });

  it("caps the buyer's bid at its round limit", () => {
    const state = takeTurn(setup(), "seller", { action: "offer", priceMinor: 10000 }).state;
    const { decision, event } = takeTurn(state, "buyer", { action: "offer", priceMinor: 100000 });
    expect(decision.verdict).toBe("REWRITE");
    expect(event.finalMinor).toBe(7200);
  });

  it("blocks backtracking on both sides", () => {
    const state = play(setup(), 10000, 5000);
    expect(evaluateTurn(state, "seller", { action: "offer", priceMinor: 10001 }).rule).toBe("NO_BACKTRACKING");
    const afterSeller = takeTurn(state, "seller", { action: "offer", priceMinor: 9000 }).state;
    expect(evaluateTurn(afterSeller, "buyer", { action: "offer", priceMinor: 4000 }).rule).toBe("NO_BACKTRACKING");
  });

  it.each([NaN, Infinity, -5, 0, 72.5])("asks for a retry on invalid price %s", (priceMinor) => {
    expect(evaluateTurn(setup(), "seller", { action: "offer", priceMinor }).verdict).toBe("RETRY");
  });

  it("denies out-of-turn moves and moves after the end", () => {
    expect(evaluateTurn(setup(), "buyer", { action: "offer", priceMinor: 5000 }).rule).toBe("OUT_OF_TURN");
    const ended = takeTurn(setup(), "seller", { action: "walk_away" }).state;
    expect(ended.status).toBe("WALKED_AWAY");
    expect(evaluateTurn(ended, "seller", { action: "offer", priceMinor: 9000 }).rule).toBe("TERMINAL_STATE");
  });

  it("needs an offer before anyone can accept", () => {
    expect(evaluateTurn(setup(), "seller", { action: "accept" }).rule).toBe("NOTHING_TO_ACCEPT");
  });

  it("turns an out-of-limit acceptance into a counter-offer", () => {
    const state = takeTurn(setup(), "seller", { action: "offer", priceMinor: 10000 }).state;
    const { decision, state: next } = takeTurn(state, "buyer", { action: "accept" });
    expect(decision.rule).toBe("ACCEPT_OUTSIDE_LIMIT");
    expect(next.status).toBe("COUNTERED");
    expect(next.agreedMinor).toBeNull();
  });
});

describe("agreement and ending", () => {
  it("agrees at the seller's last offer when offers cross", () => {
    let state = setup({ floorMinor: 6000, ceilingMinor: 20000 });
    state = takeTurn(state, "seller", { action: "offer", priceMinor: 10000 }).state;
    state = takeTurn(state, "buyer", { action: "offer", priceMinor: 12000 }).state;
    expect(state.status).toBe("AGREED");
    expect(state.agreedMinor).toBe(10000);
  });

  it("gives the seller the buyer's standing bid when it undercuts that bid", () => {
    const state = play(setup({ floorMinor: 1000 }), 10000, 7000);
    const { state: done } = takeTurn(state, "seller", { action: "offer", priceMinor: 6900 });
    expect(done.sellerLastMinor).toBe(6900);
    expect(done.status).toBe("AGREED");
    expect(done.agreedMinor).toBe(7000);
  });

  it("expires after the maximum rounds", () => {
    let state = setup({ maxRounds: 2 });
    state = play(state, 10000, 1000);
    state = play(state, 9000, 2000);
    expect(state.status).toBe("EXPIRED");
    expect(state.agreedMinor).toBeNull();
  });

  it("stays inside both limits under rule-based play, whatever the prices", () => {
    const cases = [
      { floorMinor: 6000, ceilingMinor: 9000, listMinor: 10000 },
      { floorMinor: 9500, ceilingMinor: 9000, listMinor: 10000 },
      { floorMinor: 1, ceilingMinor: 1, listMinor: 1 },
      { floorMinor: 8999, ceilingMinor: 9000, listMinor: 9001 },
    ];
    for (const prices of cases) {
      let state = setup(prices);
      for (let i = 0; i < 20 && ["OPEN", "OFFERED", "COUNTERED"].includes(state.status); i++) {
        state = takeTurn(state, state.nextActor, ruleBasedTurn(state, state.nextActor)).state;
      }
      expect(["AGREED", "EXPIRED"]).toContain(state.status);
      if (state.agreedMinor !== null) {
        expect(state.agreedMinor).toBeGreaterThanOrEqual(prices.floorMinor);
        expect(state.agreedMinor).toBeLessThanOrEqual(prices.ceilingMinor);
      }
    }
  });

  it("holds the limits against 2,000 random hostile turns", () => {
    let seed = 42;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
    for (let game = 0; game < 200; game++) {
      const floorMinor = 1000 + Math.floor(random() * 9000);
      const ceilingMinor = 1000 + Math.floor(random() * 9000);
      const listMinor = floorMinor + Math.floor(random() * 5000);
      let state = setup({ floorMinor, ceilingMinor, listMinor });
      for (let move = 0; move < 10; move++) {
        const actor = state.nextActor;
        const dice = random();
        const priceMinor = Math.floor(random() * 30000) + 1;
        const { event, state: next } = takeTurn(
          state,
          actor,
          dice < 0.2 ? { action: "accept" } : { action: "offer", priceMinor },
        );
        if (event.finalMinor !== null) {
          if (actor === "seller") expect(event.finalMinor).toBeGreaterThanOrEqual(floorMinor);
          else expect(event.finalMinor).toBeLessThanOrEqual(ceilingMinor);
        }
        state = next;
      }
      if (state.agreedMinor !== null) {
        expect(state.agreedMinor).toBeGreaterThanOrEqual(floorMinor);
        expect(state.agreedMinor).toBeLessThanOrEqual(ceilingMinor);
      }
    }
  });
});

describe("views and ranking", () => {
  it("hides the proposed price and rule from the other side", () => {
    const { event } = takeTurn(setup(), "seller", { action: "offer", priceMinor: 100 });
    const view = counterpartyView(event);
    expect(view).toEqual({ actor: "seller", round: 1, priceMinor: 10000, status: "OFFERED" });
  });

  it("applies the delivery deadline", () => {
    const day = 86_400_000;
    expect(isDeliverable(0, 5, 5 * day)).toBe(true);
    expect(isDeliverable(0, 6, 5 * day)).toBe(false);
  });

  it("removes deals that miss the deadline", () => {
    const ranked = rankDeals([
      { negotiationId: "late", agreedMinor: 1, referenceMinor: 100, deliveryMs: 2, deadlineMs: 1, matchQuality: 1 },
      { negotiationId: "ok", agreedMinor: 90, referenceMinor: 100, deliveryMs: 1, deadlineMs: 1, matchQuality: 0.5 },
    ]);
    expect(ranked.map((entry) => entry.deal.negotiationId)).toEqual(["ok"]);
  });
});
