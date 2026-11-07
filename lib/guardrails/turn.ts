/**
 * Keeps agents working when the model doesn't. Every model call gets a time
 * limit, and every failure has a safe outcome: backup rules for a negotiation
 * turn, the seller for a refund, and a neutral score for ranking.
 */
import { z } from "zod";
import { fallbackMessage, renderMessage } from "./content";
import { evaluateRefund, type OrderRecord, type RefundParams, type RefundPolicy } from "./money";
import {
  ruleBasedTurn,
  takeTurn,
  type Actor,
  type AgentTurn,
  type NegotiationState,
  type TurnEvent,
} from "./negotiation";

export const DEFAULT_CALL_TIMEOUT_MS = 20_000;
export const DEFAULT_TURN_BUDGET_MS = 30_000;
export const NEUTRAL_MATCH_QUALITY = 0.5;

/**
 * `timeout` and `outage` mean the service is struggling. `bad_output` means it
 * answered, but unusably, which includes a refusal. `circuit_open` means the
 * call was skipped because the service is believed to be down.
 */
export type FailureKind = "timeout" | "outage" | "bad_output" | "circuit_open";

/** A recoverable model problem. Any other error is a real fault and propagates. */
export class ModelFailure extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind = "bad_output",
  ) {
    super(message);
  }
}

export interface ModelRequest<T> {
  kind: "turn" | "refund" | "rerank";
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Fires when the time limit is reached, so the model can stop its request. */
  signal?: AbortSignal;
}

export interface AgentModel {
  complete<T>(request: ModelRequest<T>): Promise<T>;
}

/**
 * Skips model calls after repeated outages, so a dead service costs one quick
 * check rather than a long wait on every turn. Only timeouts and outages count.
 * If refusals counted, a hostile user could provoke them to switch off the AI
 * for everyone.
 */
export class CircuitBreaker {
  private failures = 0;
  private openUntilMs = 0;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  allowsCall(): boolean {
    return this.now() >= this.openUntilMs;
  }

  recordResponse(): void {
    this.failures = 0;
    this.openUntilMs = 0;
  }

  recordOutage(): void {
    this.failures++;
    if (this.failures >= this.threshold) this.openUntilMs = this.now() + this.cooldownMs;
  }
}

export interface CallOptions {
  timeoutMs?: number;
  /** Share one instance across all requests in the server. */
  breaker?: CircuitBreaker;
}

/** Calls the model with a time limit. Throws ModelFailure for recoverable problems. */
export async function guardedCall<T>(
  model: AgentModel,
  request: ModelRequest<T>,
  { timeoutMs = DEFAULT_CALL_TIMEOUT_MS, breaker }: CallOptions = {},
): Promise<T> {
  if (breaker && !breaker.allowsCall()) {
    throw new ModelFailure("skipped because the model service appears to be down", "circuit_open");
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ModelFailure(`no reply within ${timeoutMs}ms`, "timeout"));
    }, timeoutMs);
  });
  const call = Promise.resolve().then(() => model.complete({ ...request, signal: controller.signal }));
  call.catch(() => undefined); // A reply arriving after the time limit is ignored.
  try {
    const result = await Promise.race([call, timeout]);
    breaker?.recordResponse();
    return result;
  } catch (error) {
    if (error instanceof ModelFailure) {
      if (error.kind === "timeout" || error.kind === "outage") breaker?.recordOutage();
      else breaker?.recordResponse();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ Negotiation turn ----------------------------- */

export const TurnOutput = z.object({
  message: z.string(),
  action: z.enum(["offer", "accept", "walk_away"]),
  priceMinor: z.number().nullable(),
});
export type TurnOutput = z.infer<typeof TurnOutput>;

export type BackupReason = FailureKind | "rejected_offer" | "rejected_message" | "turn_budget";

export interface TurnMetrics {
  modelFailures: number;
  ruleFallbackTurns: number;
  messageRetries: number;
  messageFallbacks: number;
  backupReasons: Record<string, number>;
  rules: Record<string, number>;
}

export const emptyMetrics = (): TurnMetrics => ({
  modelFailures: 0,
  ruleFallbackTurns: 0,
  messageRetries: 0,
  messageFallbacks: 0,
  backupReasons: {},
  rules: {},
});

const increment = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

/** Data for the UI's backup badge and the logs. Null reason means the AI did it all. */
export interface TurnSource {
  action: "model" | "rules";
  message: "model" | "backup";
  reason: BackupReason | null;
}

export interface GuardedTurnResult {
  state: NegotiationState;
  event: TurnEvent;
  message: string;
  source: TurnSource;
}

export interface TurnOptions extends CallOptions {
  turnBudgetMs?: number;
}

const toAgentTurn = (output: TurnOutput): AgentTurn =>
  output.action === "offer"
    ? { action: "offer", priceMinor: output.priceMinor ?? Number.NaN }
    : { action: output.action };

/**
 * One full agent turn: ask the model, check the action, retry once, fall back
 * to rules, then render the message. Whatever the model does, a valid turn
 * results within the time budget. Backup rules are also limited by the
 * guardrails, because they go through takeTurn too.
 */
export async function runGuardedTurn(
  model: AgentModel,
  state: NegotiationState,
  actor: Actor,
  prompt: { system: string; user: string },
  metrics: TurnMetrics,
  options: TurnOptions = {},
): Promise<GuardedTurnResult> {
  const { timeoutMs = DEFAULT_CALL_TIMEOUT_MS, turnBudgetMs = DEFAULT_TURN_BUDGET_MS, breaker } = options;
  const deadlineMs = Date.now() + turnBudgetMs;
  const secret = actor === "seller" ? state.limits.floorMinor : state.limits.ceilingMinor;
  let problem: BackupReason | null = null;

  const ask = async (feedback?: string): Promise<TurnOutput | null> => {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      problem = "turn_budget";
      return null;
    }
    try {
      return await guardedCall(
        model,
        {
          kind: "turn",
          schema: TurnOutput,
          system: prompt.system,
          user: feedback ? `${prompt.user}\n\nYour last reply was rejected: ${feedback}` : prompt.user,
        },
        { timeoutMs: Math.min(timeoutMs, remainingMs), ...(breaker ? { breaker } : {}) },
      );
    } catch (error) {
      if (!(error instanceof ModelFailure)) throw error;
      if (error.kind !== "circuit_open") metrics.modelFailures++;
      problem = error.kind;
      return null;
    }
  };

  let accepted: ReturnType<typeof takeTurn> | null = null;
  let template = "";
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 2 && accepted === null; attempt++) {
    const output = await ask(feedback);
    if (output === null) continue;
    const result = takeTurn(state, actor, toAgentTurn(output));
    increment(metrics.rules, result.decision.rule);
    if (result.decision.verdict === "ALLOW" || result.decision.verdict === "REWRITE") {
      accepted = result;
      template = output.message;
    } else {
      feedback = result.decision.reason;
      problem = "rejected_offer";
    }
  }

  if (accepted === null) {
    const backup = takeTurn(state, actor, ruleBasedTurn(state, actor));
    const reason: BackupReason = problem ?? "rejected_offer";
    metrics.ruleFallbackTurns++;
    increment(metrics.rules, backup.decision.rule);
    increment(metrics.backupReasons, reason);
    return {
      state: backup.state,
      event: backup.event,
      message: fallbackMessage(backup.event.finalMinor, state.currency),
      source: { action: "rules", message: "backup", reason },
    };
  }

  const { finalMinor } = accepted.event;
  const render = (text: string) =>
    renderMessage({ template: text, finalMinor, currency: state.currency, secretsMinor: [secret] });

  problem = null;
  let rendered = render(template);
  if (rendered.verdict === "RETRY") {
    increment(metrics.rules, rendered.rule);
    metrics.messageRetries++;
    const again = await ask(`${rendered.reason}. Only your message will be used.`);
    if (again) rendered = render(again.message);
  }
  if (rendered.verdict === "ALLOW") {
    return {
      state: accepted.state,
      event: accepted.event,
      message: rendered.value,
      source: { action: "model", message: "model", reason: null },
    };
  }
  const reason: BackupReason = problem ?? "rejected_message";
  increment(metrics.rules, rendered.rule);
  increment(metrics.backupReasons, reason);
  metrics.messageFallbacks++;
  return {
    state: accepted.state,
    event: accepted.event,
    message: fallbackMessage(finalMinor, state.currency),
    source: { action: "model", message: "backup", reason },
  };
}

/* ---------------------------------- Refunds --------------------------------- */

export const RefundOutput = z.object({ refundMinor: z.number(), message: z.string() });

export type RefundOutcome =
  | { outcome: "refund"; params: RefundParams; proposedMinor: number; rule: string; message: string }
  /** A person decides, including when the model failed or proposed nothing. */
  | { outcome: "ask_seller"; proposedMinor: number | null; rule: string; reason: string; failure?: FailureKind }
  /** The order itself can't be refunded, whoever decides. */
  | { outcome: "rejected"; proposedMinor: number | null; rule: string; reason: string };

const REJECTED_RULES = new Set(["NOT_REFUNDABLE", "NO_CAPTURE"]);

/** Asks the model for a refund. Any failure goes to the seller, never to an automatic refund. */
export async function decideRefund(
  model: AgentModel,
  prompt: { system: string; user: string },
  order: OrderRecord,
  policy: RefundPolicy,
  options: CallOptions = {},
): Promise<RefundOutcome> {
  let proposal: z.infer<typeof RefundOutput>;
  try {
    proposal = await guardedCall(model, { kind: "refund", schema: RefundOutput, ...prompt }, options);
  } catch (error) {
    if (!(error instanceof ModelFailure)) throw error;
    return {
      outcome: "ask_seller",
      proposedMinor: null,
      rule: "MODEL_FAILED",
      reason: error.message,
      failure: error.kind,
    };
  }
  const proposedMinor = proposal.refundMinor;
  if (!Number.isSafeInteger(proposedMinor) || proposedMinor <= 0) {
    return { outcome: "ask_seller", proposedMinor, rule: "NO_USABLE_PROPOSAL", reason: "the agent proposed no valid refund" };
  }
  const decision = evaluateRefund(
    order,
    { amountMinor: proposedMinor, currency: order.currency, approvedBy: "agent" },
    policy,
  );
  if (decision.verdict === "ALLOW") {
    return { outcome: "refund", params: decision.value, proposedMinor, rule: decision.rule, message: proposal.message };
  }
  return REJECTED_RULES.has(decision.rule)
    ? { outcome: "rejected", proposedMinor, rule: decision.rule, reason: decision.reason }
    : { outcome: "ask_seller", proposedMinor, rule: decision.rule, reason: decision.reason };
}

/* ---------------------------------- Ranking --------------------------------- */

export const RerankOutput = z.object({
  scores: z.array(z.object({ id: z.string(), matchQuality: z.number() })),
});

export interface ListingScores {
  /** Pass to rankDeals, which caps each score between 0 and 1. */
  scores: Record<string, number>;
  usedBackup: boolean;
  failure?: FailureKind;
}

/** Scores listings. On failure all get the same neutral score, so price and delivery decide. */
export async function scoreListings(
  model: AgentModel,
  prompt: { system: string; user: string },
  listingIds: readonly string[],
  options: CallOptions = {},
): Promise<ListingScores> {
  const neutral = () => Object.fromEntries(listingIds.map((id) => [id, NEUTRAL_MATCH_QUALITY]));
  try {
    const output = await guardedCall(model, { kind: "rerank", schema: RerankOutput, ...prompt }, options);
    // Only requested IDs count. A listing the model skipped gets the neutral score.
    const scores = neutral();
    let matched = 0;
    for (const { id, matchQuality } of output.scores) {
      if (id in scores) {
        scores[id] = matchQuality;
        matched++;
      }
    }
    return { scores, usedBackup: matched < listingIds.length };
  } catch (error) {
    if (!(error instanceof ModelFailure)) throw error;
    return { scores: neutral(), usedBackup: true, failure: error.kind };
  }
}
