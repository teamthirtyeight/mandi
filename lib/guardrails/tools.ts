/**
 * Limits what agents can call. Each agent gets an allowlist, and scopeTool makes
 * identifiers such as seller and order IDs come from the server, not the model.
 */
import { allow, deny, type Decision } from "./core";

export type AgentRole = "seller" | "buyer";

/** Tool names from the build plan. Capture, refund, and invoice calls are absent on purpose. */
export const AGENT_TOOL_ALLOWLIST: Record<AgentRole, readonly string[]> = {
  seller: [
    "generate_listing",
    "get_comparables",
    "create_paypal_product",
    "propose_offer",
    "offer_bundle",
    "post_tracking",
    "propose_refund",
    // PayPal Agent Toolkit tools the app enables (lib/paypal/toolkit.ts).
    // Catalog, tracking and dispute reads only: still no capture, refund or order tools.
    "create_product",
    "create_shipment_tracking",
    "list_disputes",
    "get_dispute",
  ],
  buyer: [
    "parse_mandate",
    "search_listings",
    "get_reference_price",
    "propose_offer",
    "walk_away",
    "recommend_deal",
  ],
};

/** Run when building an agent. Throw on DENY so a bad tool list never reaches the model. */
export function checkToolset(role: AgentRole, toolNames: readonly string[]): Decision<readonly string[]> {
  const allowed = AGENT_TOOL_ALLOWLIST[role];
  const blocked = toolNames.filter((name) => !allowed.includes(name));
  return blocked.length > 0
    ? deny("TOOL_NOT_ALLOWED", `${role} agent cannot have: ${blocked.join(", ")}`)
    : allow("TOOLSET_OK", "all tools are on the allowlist", toolNames);
}

export interface ScopedToolDefinition<Ctx, ModelArgs extends object, ServerArgs extends object, Result> {
  name: string;
  /** The only arguments accepted from the model. Everything else is dropped. */
  modelArgKeys: readonly (keyof ModelArgs & string)[];
  /** Arguments set by the server from the session. These always win. */
  bind: (ctx: Ctx) => ServerArgs;
  /** Optional check, such as confirming this seller owns the order. */
  authorize?: (ctx: Ctx, args: ModelArgs & ServerArgs) => Decision<unknown> | Promise<Decision<unknown>>;
  execute: (args: ModelArgs & ServerArgs) => Promise<Result>;
}

export type ToolOutcome<Result> =
  | { ok: true; result: Result }
  | { ok: false; verdict: string; rule: string; reason: string };

/** Wraps a tool. `onDecision` receives each decision for the audit log. */
export function scopeTool<Ctx, ModelArgs extends object, ServerArgs extends object, Result>(
  definition: ScopedToolDefinition<Ctx, ModelArgs, ServerArgs, Result>,
  onDecision?: (entry: { tool: string; verdict: string; rule: string; reason: string }) => void,
) {
  return async (ctx: Ctx, rawArgs: unknown): Promise<ToolOutcome<Result>> => {
    const input = (typeof rawArgs === "object" && rawArgs !== null ? rawArgs : {}) as Record<string, unknown>;
    const modelArgs: Record<string, unknown> = {};
    for (const key of definition.modelArgKeys) {
      if (Object.hasOwn(input, key)) modelArgs[key] = input[key];
    }
    const args = { ...modelArgs, ...definition.bind(ctx) } as ModelArgs & ServerArgs;

    const decision: Decision<unknown> = definition.authorize
      ? await definition.authorize(ctx, args)
      : allow("TOOL_SCOPED", "arguments bound by the server", undefined);

    onDecision?.({
      tool: definition.name,
      verdict: decision.verdict,
      rule: decision.rule,
      reason: decision.reason,
    });

    if (decision.verdict !== "ALLOW") {
      return { ok: false, verdict: decision.verdict, rule: decision.rule, reason: decision.reason };
    }
    return { ok: true, result: await definition.execute(args) };
  };
}
