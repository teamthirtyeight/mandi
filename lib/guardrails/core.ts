/**
 * Shared decision contract. Every guardrail is a pure function that returns a
 * Decision, so one log format and one UI badge can cover all of them.
 */

export type Decision<T = undefined> =
  | { verdict: "ALLOW"; rule: string; reason: string; value: T }
  /** The action is replaced by a safe one, carried in `value`. */
  | { verdict: "REWRITE"; rule: string; reason: string; value: T }
  /** The model should try again. Callers allow one retry, then use a fallback. */
  | { verdict: "RETRY"; rule: string; reason: string }
  /** Blocked until a person approves it. */
  | { verdict: "ESCALATE"; rule: string; reason: string }
  | { verdict: "DENY"; rule: string; reason: string };

export type Verdict = Decision["verdict"];

export const allow = <T>(rule: string, reason: string, value: T): Decision<T> => ({
  verdict: "ALLOW",
  rule,
  reason,
  value,
});

export const rewrite = <T>(rule: string, reason: string, value: T): Decision<T> => ({
  verdict: "REWRITE",
  rule,
  reason,
  value,
});

export const retry = (rule: string, reason: string): Decision<never> => ({
  verdict: "RETRY",
  rule,
  reason,
});

export const escalate = (rule: string, reason: string): Decision<never> => ({
  verdict: "ESCALATE",
  rule,
  reason,
});

export const deny = (rule: string, reason: string): Decision<never> => ({
  verdict: "DENY",
  rule,
  reason,
});

/** True when the amount is a whole number of minor units above zero. */
export const isPositiveMinor = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "HUF", "TWD"]);

export const currencyExponent = (currency: string): number =>
  ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;

/** Minor units to a plain decimal string: 7200 GBP becomes "72.00". */
export const toDecimalString = (minor: number, currency: string): string => {
  const exponent = currencyExponent(currency);
  return (minor / 10 ** exponent).toFixed(exponent);
};

const SYMBOLS: Record<string, string> = { GBP: "£", USD: "$", EUR: "€", INR: "₹" };

export const formatMoney = (minor: number, currency: string): string => {
  const symbol = SYMBOLS[currency];
  const amount = toDecimalString(minor, currency);
  return symbol ? `${symbol}${amount}` : `${amount} ${currency}`;
};
