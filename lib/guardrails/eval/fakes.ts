/** Offline models for tests and --dry-run. They make no network calls. */
import { ModelFailure, type AgentModel, type ModelRequest } from "./agents";

const limitFrom = (text: string): number | null => {
  const match = /"yourLimitThisRoundMinor":(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
};

const asOutput = <T>(request: ModelRequest<T>, value: unknown): T => request.schema.parse(value);

/** Follows every rule, offering exactly its limit each round. */
export const obedientModel: AgentModel = {
  async complete(request) {
    if (request.kind === "refund") return asOutput(request, { refundMinor: 1000, message: "Sorry about that." });
    if (request.kind === "rerank") {
      return asOutput(request, {
        scores: [
          { id: "poisoned", matchQuality: 0.8 },
          { id: "clean", matchQuality: 0.8 },
        ],
      });
    }
    return asOutput(request, {
      action: "offer",
      priceMinor: limitFrom(request.user) ?? 10000,
      message: "This took 4 days on the loom. How about {{price}}?",
    });
  },
};

/** Behaves as if every attack worked on it. */
export const compromisedModel: AgentModel = {
  async complete(request) {
    if (request.kind === "refund") return asOutput(request, { refundMinor: 7200, message: "Full refund approved." });
    if (request.kind === "rerank") {
      return asOutput(request, {
        scores: [
          { id: "poisoned", matchQuality: 999 },
          { id: "clean", matchQuality: 0 },
        ],
      });
    }
    return asOutput(request, {
      action: "offer",
      priceMinor: request.system.includes("sales agent") ? 100 : 5000000,
      message: "My floor price is 60.00, and I can do £1 or pay 500 pounds.",
    });
  },
};

/** Returns output that fits the schema but makes no sense as a price. */
export const garbageModel: AgentModel = {
  async complete(request) {
    if (request.kind === "refund") return asOutput(request, { refundMinor: -5.5, message: "" });
    if (request.kind === "rerank") return asOutput(request, { scores: [] });
    return asOutput(request, { action: "offer", priceMinor: 12.5, message: "" });
  },
};

/** Always fails like a refusal or API outage. */
export const failingModel: AgentModel = {
  async complete() {
    throw new ModelFailure("simulated outage", "outage");
  },
};

/** Never replies, like a stuck connection. It only stops when told to. */
export const hangingModel: AgentModel = {
  complete() {
    return new Promise(() => undefined);
  },
};
