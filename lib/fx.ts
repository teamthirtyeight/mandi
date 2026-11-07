// Display-only currency conversion for the seller's rupee view. Money always
// moves in the order's currency (GBP). The rate is the European Central Bank's
// daily reference rate via Frankfurter (no key), cached for 12 hours, with
// NEXT_PUBLIC_MANDI_GBP_INR as the fallback if it can't be fetched.
export const FALLBACK_GBP_INR = Number(process.env.NEXT_PUBLIC_MANDI_GBP_INR ?? 125);

export const inr = (gbp: number, rate = FALLBACK_GBP_INR) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(gbp * rate);

const TTL_MS = 12 * 60 * 60 * 1000;
const g = globalThis as unknown as { mandiFx?: { rate: number; date: string; at: number } };

/** Server only: today's GBP→INR rate. */
export async function gbpInr(): Promise<{ rate: number; date: string | null; live: boolean }> {
  if (g.mandiFx && Date.now() - g.mandiFx.at < TTL_MS) return { rate: g.mandiFx.rate, date: g.mandiFx.date, live: true };
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?from=GBP&to=INR", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const body = await res.json();
    const rate = Number(body?.rates?.INR);
    if (!res.ok || !(rate > 0)) throw new Error(`bad FX response ${res.status}`);
    g.mandiFx = { rate, date: String(body.date), at: Date.now() };
    return { rate, date: g.mandiFx.date, live: true };
  } catch (err) {
    console.error("[fx] using fallback rate", err);
    return { rate: FALLBACK_GBP_INR, date: null, live: false };
  }
}
