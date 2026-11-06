// One place where Mandi calls Claude. Returns null instead of throwing when
// the model is unavailable, refuses, or returns output that fails the schema,
// so every caller can fall back to deterministic rules and the demo never stalls.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

// The build plan names "Claude Sonnet (latest)"; override with MANDI_MODEL.
export const MODEL = process.env.MANDI_MODEL ?? "claude-sonnet-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** MANDI_FAKE_AI=1 skips the model entirely (tests, offline demos). */
export const aiEnabled = () =>
  process.env.MANDI_FAKE_AI !== "1" && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export interface StructuredCall<T extends z.ZodType> {
  label: string;
  schema: T;
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[] | string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export async function structured<T extends z.ZodType>(call: StructuredCall<T>): Promise<z.infer<T> | null> {
  if (!aiEnabled()) return null;
  const started = Date.now();
  try {
    const response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: call.maxTokens ?? 2000,
      // Server-side fallback re-runs a classifier-declined request on another model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: call.effort ?? "low", format: zodOutputFormat(call.schema) },
      system: call.system,
      messages: [{ role: "user", content: call.content }],
    });

    console.info(
      `[claude] ${call.label} ${response.stop_reason} in=${response.usage.input_tokens} out=${response.usage.output_tokens} ${Date.now() - started}ms`,
    );
    if (response.stop_reason !== "end_turn") return null;
    const parsed = call.schema.safeParse(response.parsed_output);
    return parsed.success ? parsed.data : null;
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error(`[claude] ${call.label} API error ${err.status}: ${err.message}`);
    } else {
      console.error(`[claude] ${call.label} failed`, err);
    }
    return null;
  }
}
