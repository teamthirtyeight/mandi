// Deterministic deal scoring: price vs budget and reference, delivery slack vs
// deadline, and how well the listing matched the request. Pure function.
export interface DealCandidate {
  negotiationId: string;
  sellerName: string;
  title: string;
  agreedMinor: number;
  currency: string;
  arrival: Date;
  /** 0..1, from the listing search. */
  match: number;
  /** Bundle add-on accepted by the buyer agent, if any. */
  addon?: { title: string; priceMinor: number } | null;
}

export interface ScoredDeal extends DealCandidate {
  score: number;
  reasons: string[];
}

export interface Recommendation {
  best: ScoredDeal | null;
  ranked: ScoredDeal[];
}

const DAY = 24 * 60 * 60 * 1000;
const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function scoreDeals(opts: {
  deals: DealCandidate[];
  ceilingMinor: number;
  referenceMinor: number | null;
  deadline: Date;
  now?: Date;
  weights?: { price: number; delivery: number; match: number };
}): Recommendation {
  const w = opts.weights ?? { price: 0.6, delivery: 0.3, match: 0.1 };
  const now = opts.now ?? new Date();
  const window = Math.max(1, (opts.deadline.getTime() - now.getTime()) / DAY);

  const ranked = opts.deals
    .map((d) => {
      const priceScore = Math.max(0, (opts.ceilingMinor - d.agreedMinor) / opts.ceilingMinor);
      const slackDays = Math.floor((opts.deadline.getTime() - d.arrival.getTime()) / DAY);
      const deliveryScore = Math.min(1, Math.max(0, slackDays / window));
      // Price and delivery count in proportion to how well the item matched, so a
      // cheap item that isn't what was asked for (a cushion cover for "wool shawl")
      // can't win on price alone.
      const score = d.match * (w.price * priceScore + w.delivery * deliveryScore) + w.match * d.match;

      const reasons = [`${money(d.agreedMinor, d.currency)}, ${money(opts.ceilingMinor - d.agreedMinor, d.currency)} under budget`];
      // The reference price is for what the buyer asked for, so only compare close matches with it.
      if (opts.referenceMinor != null && d.match >= 0.6) {
        const diff = opts.referenceMinor - d.agreedMinor;
        reasons.push(
          diff >= 0
            ? `${money(diff, d.currency)} below similar products`
            : `${money(-diff, d.currency)} above similar products`,
        );
      }
      reasons.push(`Arrives ${shortDate(d.arrival)}, ${slackDays} day${slackDays === 1 ? "" : "s"} before the deadline`);
      if (d.addon) {
        reasons.push(
          `Bundle: adds ${d.addon.title} for ${money(d.addon.priceMinor, d.currency)} (total ${money(d.agreedMinor + d.addon.priceMinor, d.currency)}, within budget)`,
        );
      }
      return { ...d, score: Math.round(score * 1000) / 1000, reasons };
    })
    .sort((a, b) => b.score - a.score);

  return { best: ranked[0] ?? null, ranked };
}
