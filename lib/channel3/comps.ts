// Comparable products from Channel3: the seller's suggested price range and the
// buyer's reference price. Cached per query; returns null when Channel3 is not
// configured or finds too few priced offers, and callers carry on without it.
import { Channel3 } from "@channel3/sdk";

export interface Comps {
  query: string;
  currency: string;
  count: number;
  lowMinor: number;
  medianMinor: number;
  highMinor: number;
  samples: { title: string; priceMinor: number; url: string | null }[];
}

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; value: Comps | null }>();
let client: Channel3 | null = null;

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
};

export async function getComps(opts: {
  query?: string;
  base64Image?: string;
  country?: "GB" | "US";
}): Promise<Comps | null> {
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey || (!opts.query && !opts.base64Image)) return null;

  const country = opts.country ?? "GB";
  const key = `${country}:${opts.query ?? ""}:${opts.base64Image ? opts.base64Image.length : 0}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: Comps | null = null;
  try {
    client ??= new Channel3({ apiKey });
    const res = await client.products.search({
      query: opts.query,
      base64_image: opts.base64Image,
      limit: 20,
      config: { country },
    });

    const currency = country === "GB" ? "GBP" : "USD";
    const priced = res.data
      .map((p) => {
        const offer = p.offers?.find((o) => o.price?.currency === currency);
        return offer ? { title: p.title, priceMinor: Math.round(offer.price.price * 100), url: offer.url ?? null } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null && x.priceMinor > 0);

    if (priced.length >= 3) {
      const prices = priced.map((p) => p.priceMinor).sort((a, b) => a - b);
      value = {
        query: opts.query ?? "image",
        currency,
        count: prices.length,
        lowMinor: quantile(prices, 0.25),
        medianMinor: quantile(prices, 0.5),
        highMinor: quantile(prices, 0.75),
        samples: priced.slice(0, 5),
      };
    }
  } catch (err) {
    console.error("[channel3] search failed", err);
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}
