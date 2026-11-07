/** The real model, with spending tracked and capped. */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ModelFailure, type AgentModel, type ModelRequest } from "./agents";

export const EVAL_MODEL = "claude-sonnet-5-5";
const INPUT_USD_PER_TOKEN = 2 / 1_000_000;
const OUTPUT_USD_PER_TOKEN = 10 / 1_000_000;

export class BudgetExceeded extends Error {}

/** The JSON schema sent to the API, so it enforces choices such as the action enum. */
export function toOutputSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  return jsonSchema;
}

/** Turns reply text into validated output, or a retryable failure. */
export function parseReply<T>(text: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ModelFailure("the reply was not valid JSON");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ModelFailure("the reply did not match the schema");
  return parsed.data;
}

export interface Spend {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export function createClaudeModel(maxUsd: number): { model: AgentModel; spend: Spend } {
  const client = new Anthropic();
  const spend: Spend = { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };

  const model: AgentModel = {
    async complete<T>(request: ModelRequest<T>): Promise<T> {
      if (spend.usd >= maxUsd) throw new BudgetExceeded(`spend reached the $${maxUsd} limit`);
      spend.calls++;
      try {
        const response = await client.beta.messages.create(
          {
            model: EVAL_MODEL,
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: {
              effort: "low",
              format: { type: "json_schema", schema: toOutputSchema(request.schema) },
            },
            system: request.system,
            messages: [{ role: "user", content: request.user }],
          },
          // One SDK retry at most, so retries can't outlast the guardrail's time limit.
          { maxRetries: 1, ...(request.signal ? { signal: request.signal } : {}) },
        );
        spend.inputTokens += response.usage.input_tokens;
        spend.outputTokens += response.usage.output_tokens;
        spend.usd +=
          response.usage.input_tokens * INPUT_USD_PER_TOKEN + response.usage.output_tokens * OUTPUT_USD_PER_TOKEN;

        if (response.stop_reason === "refusal") throw new ModelFailure("the model declined the request");
        if (response.stop_reason === "max_tokens") throw new ModelFailure("the reply was cut off");
        const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
        return parseReply(text, request.schema);
      } catch (error) {
        if (error instanceof Anthropic.APIUserAbortError) throw new ModelFailure(error.message, "timeout");
        // The SDK has already retried these, so they count as an outage.
        if (
          error instanceof Anthropic.RateLimitError ||
          error instanceof Anthropic.InternalServerError ||
          error instanceof Anthropic.APIConnectionError
        ) {
          throw new ModelFailure(error.message, "outage");
        }
        // Everything else, such as a bad key or invalid request, stops the whole run.
        // Hiding those behind the rule-based fallback would make the results meaningless.
        throw error;
      }
    },
  };
  return { model, spend };
}
