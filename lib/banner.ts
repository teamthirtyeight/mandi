// Image cards for WhatsApp alerts: "Sold! ₹10,057" in the seller's language,
// with the listing photo (or its woven swatch), in Mandi's colours.
//
// Cards are HTML screenshotted by headless Chrome (playwright-core), because
// Indian scripts need real text shaping that SVG/satori renderers get wrong.
// Twilio downloads each card from a signed URL (/api/whatsapp/banner), so the
// order details behind a card can't be browsed by guessing links.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Browser } from "playwright-core";
import { swatchStyle } from "@/lib/swatch";
import type { SellerLanguage } from "@/lib/i18n/seller";

export const BANNER_SIZE = { width: 1200, height: 750 };

export type BannerTone = "agreed" | "safe" | "bad" | "progress" | "plain";

export interface BannerData {
  lang: SellerLanguage;
  tone: BannerTone;
  chip: string | null; // short status, e.g. "भेजना है"
  headline: string; // e.g. "बिक गया! ₹10,057"
  sub: string | null; // e.g. "£80.00"
  body: string | null; // e.g. "कृपया 2 दिन में भेजें। …"
  listingTitle: string | null;
  image: string | null; // data: URL of the listing photo
  sellerName: string;
}

// ---- signed links -------------------------------------------------------

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

/** Signature over the banner's parameters (kind, id, extra). */
export function signBanner(parts: string[]): string {
  return createHmac("sha256", secret()).update(`banner|${parts.join("|")}`).digest("base64url").slice(0, 32);
}

export function verifyBanner(parts: string[], sig: string | null): boolean {
  if (!sig) return false;
  const expected = Buffer.from(signBanner(parts));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---- the card -------------------------------------------------------------

const SCRIPT_FONT: Record<SellerLanguage, string> = {
  en: "Anek Latin",
  hi: "Anek Devanagari",
  mr: "Anek Devanagari",
  bn: "Anek Bangla",
  ta: "Anek Tamil",
  te: "Anek Telugu",
  gu: "Anek Gujarati",
  kn: "Anek Kannada",
  ml: "Anek Malayalam",
  pa: "Anek Gurmukhi",
  or: "Anek Odia",
};

// Light-theme tokens from app/globals.css.
const TONE: Record<BannerTone, { band: string; chipBg: string; chipInk: string; headline: string }> = {
  agreed: { band: "#e9a21b", chipBg: "#fdf3dc", chipInk: "#7a4f00", headline: "#151935" },
  safe: { band: "#1e7a4c", chipBg: "#e3f4ea", chipInk: "#1e7a4c", headline: "#1e7a4c" },
  bad: { band: "#b53a2a", chipBg: "#fbe9e6", chipInk: "#b53a2a", headline: "#151935" },
  progress: { band: "#2f3fa0", chipBg: "#e8ebfa", chipInk: "#2f3fa0", headline: "#151935" },
  plain: { band: "#6b7194", chipBg: "#f4f5f9", chipInk: "#4a5072", headline: "#151935" },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function bannerHtml(d: BannerData): string {
  const tone = TONE[d.tone];
  const script = SCRIPT_FONT[d.lang];
  const families = [...new Set(["Anek Latin", script])]
    .map((f) => `family=${f.replace(/ /g, "+")}:wdth,wght@75..125,400..800`)
    .join("&");
  const swatch = swatchStyle(d.listingTitle ?? d.sellerName);
  const picture = d.image
    ? `<img src="${esc(d.image)}" alt="">`
    : `<div class="swatch" style="background-color:${swatch.backgroundColor};background-image:${esc(swatch.backgroundImage)}"></div>`;

  return `<!doctype html>
<html lang="${d.lang}">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${families}&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${BANNER_SIZE.width}px; height: ${BANNER_SIZE.height}px; }
  body {
    display: grid; grid-template-columns: 1fr 430px;
    position: relative; background: #ffffff; color: #151935; overflow: hidden;
    font-family: "${script}", "Anek Latin", sans-serif;
  }
  main { position: relative; display: flex; flex-direction: column; padding: 64px 64px 72px 72px; }
  body::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 18px; background: ${tone.band}; z-index: 2; }
  .brand { display: flex; align-items: baseline; gap: 12px; }
  .brand b { font-family: "Anek Latin"; font-variation-settings: "wdth" 118; font-weight: 800; font-size: 40px; letter-spacing: -0.01em; }
  .brand i { font-family: "Anek Devanagari"; font-style: normal; font-size: 26px; color: #6b7194; }
  .who { margin-left: auto; font-family: "Anek Latin"; font-size: 24px; color: #6b7194; }
  .chip { align-self: flex-start; margin-top: 56px; padding: 6px 20px; border-radius: 999px; background: ${tone.chipBg}; color: ${tone.chipInk}; font-weight: 650; font-size: 28px; }
  h1 { margin-top: 22px; font-weight: 750; font-variation-settings: "wdth" 108; font-size: 76px; line-height: 1.12; color: ${tone.headline}; letter-spacing: -0.01em; }
  .sub { margin-top: 6px; font-family: "Anek Latin"; font-variant-numeric: tabular-nums; font-size: 34px; font-weight: 600; color: #4a5072; }
  .item { margin-top: auto; font-size: 30px; font-weight: 600; line-height: 1.25; }
  .body { margin-top: 10px; font-size: 27px; line-height: 1.4; color: #4a5072; max-width: 640px; }
  aside { position: relative; overflow: hidden; }
  aside img, .swatch { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  aside::after { content: ""; position: absolute; inset: 0; box-shadow: inset 12px 0 24px -12px rgb(21 25 53 / 0.35); }
</style>
</head>
<body>
  <main>
    <div class="brand"><b>Mandi</b><i>मंडी</i><span class="who">${esc(d.sellerName)}</span></div>
    ${d.chip ? `<span class="chip">${esc(d.chip)}</span>` : `<span style="margin-top:56px"></span>`}
    <h1>${esc(d.headline)}</h1>
    ${d.sub ? `<p class="sub">${esc(d.sub)}</p>` : ""}
    ${d.listingTitle ? `<p class="item" lang="en" style="font-family:'Anek Latin'">${esc(d.listingTitle)}</p>` : ""}
    ${d.body ? `<p class="body"${d.listingTitle ? "" : ' style="margin-top:auto"'}>${esc(d.body)}</p>` : ""}
  </main>
  <aside>${picture}</aside>
</body>
</html>`;
}

// ---- rendering --------------------------------------------------------------

let browserPromise: Promise<Browser> | null = null;

async function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright-core");
      // Prefer the installed Chrome; fall back to Playwright's own Chromium (Render).
      return chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
    })();
    browserPromise.catch(() => (browserPromise = null));
  }
  return browserPromise;
}

// Rendered cards by key, shared by the pre-render in lib/notify.ts and the
// route Twilio downloads from, so Twilio's fetch is instant.
const cache = new Map<string, Buffer>();

/** Renders a card once per key; later calls reuse the PNG. */
export async function renderBannerCached(key: string, data: () => Promise<BannerData | null>): Promise<Buffer | null> {
  const hit = cache.get(key);
  if (hit) return hit;
  const d = await data();
  if (!d) return null;
  const png = await renderBanner(d);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  cache.set(key, png);
  return png;
}

/** Renders the card to a PNG. */
export async function renderBanner(d: BannerData): Promise<Buffer> {
  const page = await (await browser()).newPage({ viewport: BANNER_SIZE, deviceScaleFactor: 1 });
  try {
    await page.setContent(bannerHtml(d), { waitUntil: "networkidle", timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}
