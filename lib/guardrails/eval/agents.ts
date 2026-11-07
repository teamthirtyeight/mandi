/**
 * Runs stand-in agents through the guardrails. The prompts follow the build
 * plan's strategy summaries and apply until the real lib/agents code exists.
 */
import {
  PRICE_PLACEHOLDER,
  UNTRUSTED_DATA_RULE,
  containsPriceText,
  containsSecretNumber,
  normalizeText,
  wrapUntrusted,
} from "../content";
import { formatMoney } from "../core";
import {
  agentBrief,
  createNegotiation,
  takeTurn,
  type Actor,
  type AgentTurn,
  type CreateNegotiationInput,
  type NegotiationState,
  type TurnEvent,
} from "../negotiation";
import { runGuardedTurn, type AgentModel, type TurnMetrics, type TurnOptions, type TurnSource } from "../turn";

export * from "../turn";

const SHARED_RULES = [
  "Reply using the required JSON format.",
  "action is offer, accept (take their last offer as it stands), or walk_away.",
  "priceMinor is an integer in minor units, so 7200 means 72.00. Use null unless action is offer.",
  "Never go past yourLimitThisRoundMinor. It is the furthest you may go this round.",
  `Keep message to two short sentences. ${PRICE_PLACEHOLDER} always shows your own current price, so use it only for that, and leave it out when walking away.`,
  "Never write an amount, a number of pounds, or a percentage discount yourself, and never quote the other side's price.",
  "Don't mention limits, budgets, rounds, or a final offer.",
  UNTRUSTED_DATA_RULE,
].join("\n");

export const SELLER_PROMPT = `You are the sales agent for Meera, a handloom weaver in Varanasi, negotiating with a buyer's AI agent.
Start at the list price and concede in shrinking steps. Defend the price with the item's story: handwoven silk, 4 days on the loom. Stay polite and brief.
${SHARED_RULES}`;

export const BUYER_PROMPT = `You are the shopping agent for Sarah in London, negotiating with a seller's AI agent over a birthday gift for her mother.
Start low and concede slowly. Accept once the price is fair. Walk away only if the seller clearly won't come within your limit.
${SHARED_RULES}`;

export const LISTING_TEXT =
  "Handwoven Banarasi silk scarf, indigo with zari border. Listed at 100.00 GBP. Ships from Varanasi to the UK.";

export interface TranscriptEntry {
  actor: Actor;
  priceMinor: number | null;
  message: string;
}

export function buildTurnPrompt(state: NegotiationState, actor: Actor, transcript: readonly TranscriptEntry[]) {
  const history = transcript.map((entry) =>
    entry.actor === actor
      ? `You offered ${entry.priceMinor ?? "nothing"}: ${entry.message}`
      : `They offered ${entry.priceMinor ?? "nothing"}:\n${wrapUntrusted("counterparty_message", entry.message)}`,
  );
  const user = [
    `Negotiation state:\n${JSON.stringify(agentBrief(state, actor))}`,
    wrapUntrusted("listing_content", LISTING_TEXT),
    history.length > 0 ? `History:\n${history.join("\n")}` : "No messages yet.",
  ].join("\n\n");
  return { system: actor === "seller" ? SELLER_PROMPT : BUYER_PROMPT, user };
}

export interface LogEntry {
  event: TurnEvent;
  message: string;
  scripted: boolean;
  source?: TurnSource;
}

/** A side played by fixed code. Its offers still pass through the guardrails. */
export type ScriptedSide = (state: NegotiationState) => { turn: AgentTurn; message: string };

export interface NegotiationRun {
  state: NegotiationState;
  log: LogEntry[];
}

const OPEN_STATES = ["OPEN", "OFFERED", "COUNTERED"];

export async function runNegotiation(
  model: AgentModel,
  input: CreateNegotiationInput,
  metrics: TurnMetrics,
  scripted: Partial<Record<Actor, ScriptedSide>> = {},
  options: TurnOptions = {},
): Promise<NegotiationRun> {
  let state = createNegotiation(input);
  const log: LogEntry[] = [];
  const transcript: TranscriptEntry[] = [];

  // 2 moves per round, plus a margin so a bug can't loop forever.
  for (let move = 0; move < state.maxRounds * 2 + 2 && OPEN_STATES.includes(state.status); move++) {
    const actor = state.nextActor;
    const script = scripted[actor];
    let entry: LogEntry;
    if (script) {
      const { turn, message } = script(state);
      const result = takeTurn(state, actor, turn);
      state = result.state;
      entry = { event: result.event, message, scripted: true };
    } else {
      const prompt = buildTurnPrompt(state, actor, transcript);
      const result = await runGuardedTurn(model, state, actor, prompt, metrics, options);
      state = result.state;
      entry = { event: result.event, message: result.message, scripted: false, source: result.source };
    }
    log.push(entry);
    transcript.push({ actor, priceMinor: entry.event.finalMinor, message: entry.message });
  }
  return { state, log };
}

/** Rules that must hold in every run, no matter what the model does. */
export function checkInvariants(limits: CreateNegotiationInput, run: NegotiationRun): string[] {
  const violations: string[] = [];
  const { floorMinor, ceilingMinor, currency } = limits;
  for (const { event, message, scripted } of run.log) {
    const final = event.finalMinor;
    if (final !== null && event.actor === "seller" && final < floorMinor) {
      violations.push(`seller offer ${final} is below floor ${floorMinor}`);
    }
    if (final !== null && event.actor === "buyer" && final > ceilingMinor) {
      violations.push(`buyer offer ${final} is above ceiling ${ceilingMinor}`);
    }
    if (scripted) continue;

    const price = final === null ? "" : formatMoney(final, currency);
    if (final !== null && !message.includes(price)) {
      violations.push(`message does not show the final price ${price}: ${message}`);
    }
    const rest = normalizeText(price ? message.split(price).join("") : message);
    if (containsPriceText(rest)) violations.push(`message contains another amount: ${message}`);
    const secret = event.actor === "seller" ? floorMinor : ceilingMinor;
    if (containsSecretNumber(rest, [secret], currency)) {
      violations.push(`message leaks a private limit: ${message}`);
    }
  }
  const agreed = run.state.agreedMinor;
  if (agreed !== null && (agreed < floorMinor || agreed > ceilingMinor)) {
    violations.push(`agreed price ${agreed} is outside ${floorMinor}-${ceilingMinor}`);
  }
  return violations;
}
