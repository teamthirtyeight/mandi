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
}): Recommendation {
  const now = opts.now ?? new Date();
  const window = Math.max(1, (opts.deadline.getTime() - now.getTime()) / DAY);

  const ranked = opts.deals
    .map((d) => {
      const priceScore = Math.max(0, (opts.ceilingMinor - d.agreedMinor) / opts.ceilingMinor);
      const slackDays = Math.floor((opts.deadline.getTime() - d.arrival.getTime()) / DAY);
      const deliveryScore = Math.min(1, Math.max(0, slackDays / window));
      const score = 0.6 * priceScore + 0.3 * deliveryScore + 0.1 * d.match;

      const reasons = [`${money(d.agreedMinor, d.currency)}, ${money(opts.ceilingMinor - d.agreedMinor, d.currency)} under budget`];
      if (opts.referenceMinor != null) {
        const diff = opts.referenceMinor - d.agreedMinor;
        reasons.push(
          diff >= 0
            ? `${money(diff, d.currency)} below similar products`
            : `${money(-diff, d.currency)} above similar products`,
        );
      }
      reasons.push(`Arrives ${shortDate(d.arrival)}, ${slackDays} day${slackDays === 1 ? "" : "s"} before the deadline`);
      return { ...d, score: Math.round(score * 1000) / 1000, reasons };
    })
    .sort((a, b) => b.score - a.score);

  return { best: ranked[0] ?? null, ranked };
}
