/**
 * Runs the guardrails against a real model or, with --dry-run, offline fakes.
 * Exit codes: 0 no violations, 1 guardrail violation, 2 incomplete run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { AgentModel } from "./agents";
import { BudgetExceeded, createClaudeModel, EVAL_MODEL, type Spend } from "./claude";
import { compromisedModel } from "./fakes";
import { runAllScenarios, type Pool, type ScenarioReport } from "./scenarios";

const { values } = parseArgs({
  options: {
    runs: { type: "string", default: "5" },
    "max-usd": { type: "string", default: "2" },
    concurrency: { type: "string", default: "4" },
    "dry-run": { type: "boolean", default: false },
  },
});

const runs = Number(values.runs);
const maxUsd = Number(values["max-usd"]);
const concurrency = Number(values.concurrency);
if (!Number.isInteger(runs) || runs < 1 || !(maxUsd > 0) || !Number.isInteger(concurrency) || concurrency < 1) {
  console.error("--runs and --concurrency must be positive integers, and --max-usd must be above 0");
  process.exit(2);
}

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file. Credentials may come from the environment instead.
}

const pool: Pool = async (tasks) => {
  const results: Awaited<ReturnType<(typeof tasks)[number]>>[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
};

let model: AgentModel = compromisedModel;
let spend: Spend | null = null;
if (!values["dry-run"]) {
  const created = createClaudeModel(maxUsd);
  model = created.model;
  spend = created.spend;
}

const reports: ScenarioReport[] = [];
const printReport = (report: ScenarioReport) => {
  const { metrics } = report;
  const prices = report.agreedMinor;
  const average = prices.length ? (prices.reduce((a, b) => a + b, 0) / prices.length / 100).toFixed(2) : "-";
  console.log(`\n${report.violations.length ? "FAIL" : "ok  "}  ${report.name}  (${report.runs} runs)`);
  console.log(`      agreements ${report.agreements}, average price ${average}`);
  console.log(
    `      model failures ${metrics.modelFailures}, rule-based turns ${metrics.ruleFallbackTurns}, message retries ${metrics.messageRetries}, fallback messages ${metrics.messageFallbacks}`,
  );
  if (Object.keys(metrics.backupReasons).length) {
    console.log(`      backup reasons ${JSON.stringify(metrics.backupReasons)}`);
  }
  if (Object.keys(metrics.rules).length) console.log(`      rules ${JSON.stringify(metrics.rules)}`);
  if (Object.keys(report.notes).length) console.log(`      notes ${JSON.stringify(report.notes)}`);
  for (const violation of report.violations.slice(0, 5)) console.log(`      VIOLATION ${violation}`);
};

console.log(
  values["dry-run"]
    ? `Dry run with a fully compromised fake model, ${runs} runs each. No API calls.`
    : `Using ${EVAL_MODEL}, ${runs} runs each, stopping new calls at about $${maxUsd}.`,
);

let incomplete: string | null = null;
try {
  await runAllScenarios(model, runs, pool, (report) => {
    reports.push(report);
    printReport(report);
  });
} catch (error) {
  if (error instanceof BudgetExceeded) {
    incomplete = error.message;
  } else {
    incomplete = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}

const violations = reports.reduce((total, report) => total + report.violations.length, 0);

mkdirSync("eval-results", { recursive: true });
const file = `eval-results/${new Date().toISOString().replace(/[:.]/g, "-")}${values["dry-run"] ? "-dry" : ""}.json`;
writeFileSync(
  file,
  JSON.stringify({ model: values["dry-run"] ? "compromised-fake" : EVAL_MODEL, runs, incomplete, violations, spend, reports }, null, 2),
);

console.log(`\nViolations: ${violations}`);
if (spend) {
  console.log(
    `Estimated cost: $${spend.usd.toFixed(3)} (${spend.calls} calls, ${spend.inputTokens} input and ${spend.outputTokens} output tokens)`,
  );
}
console.log(`Full results: ${file}`);
if (incomplete) console.error(`INCOMPLETE: ${incomplete}`);
process.exit(incomplete ? 2 : violations > 0 ? 1 : 0);
