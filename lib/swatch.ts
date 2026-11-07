// Woven-swatch colours for listings without photos, in natural-dye colours.
// Colour words in the title pick the dye ("indigo", "rose", "peacock");
// otherwise the title picks one consistently. Shared by the site
// (components/ListingImage) and the WhatsApp banners, so both match.
export const DYES = {
  indigo: ["#2c3a8c", "#5b6bc9", "#1b2466"],
  madder: ["#9c3b2e", "#c8665a", "#5e1f17"],
  haldi: ["#c98a12", "#e9b54a", "#7a5208"],
  pomegranate: ["#7d2a4a", "#b05a7c", "#4a1328"],
  peacock: ["#1f6f78", "#4ea2a8", "#0f3f45"],
  leaf: ["#2f6b4f", "#5f9c7c", "#173d2b"],
  walnut: ["#6b4a2f", "#9c7652", "#3d2817"],
} as const;

const WORDS: [RegExp, keyof typeof DYES][] = [
  [/peacock|teal|turquoise/i, "peacock"],
  [/indigo|blue|navy/i, "indigo"],
  [/rose|pink|red|madder|crimson/i, "madder"],
  [/gold|yellow|saffron|turmeric|mustard/i, "haldi"],
  [/green|emerald|leaf/i, "leaf"],
  [/maroon|plum|purple|wine/i, "pomegranate"],
  [/brown|walnut|wood|tan/i, "walnut"],
];

/** CSS background for a listing's woven swatch. */
export function swatchStyle(title: string): { backgroundColor: string; backgroundImage: string } {
  const names = Object.keys(DYES) as (keyof typeof DYES)[];
  const hash = [...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 0);
  const dye = WORDS.find(([re]) => re.test(title))?.[1] ?? names[hash % names.length];
  const [base, light, dark] = DYES[dye];
  // Where the woven band sits varies by title, so same-dye swatches still differ.
  const band = 58 + (hash % 5) * 7;
  return {
    backgroundColor: base,
    backgroundImage: [
      // weft: fine horizontal threads
      `repeating-linear-gradient(0deg, rgb(255 255 255 / 0.07) 0 1px, transparent 1px 4px)`,
      // warp: a border band and thin accent threads, like a woven edge
      `linear-gradient(90deg, transparent 0 ${band}%, ${dark} ${band}% ${band + 2}%, ${light} ${band + 2}% ${band + 6}%, ${dark} ${band + 6}% ${band + 8}%, transparent ${band + 8}%)`,
      `repeating-linear-gradient(90deg, transparent 0 22px, rgb(255 255 255 / 0.10) 22px 23px)`,
    ].join(", "),
  };
}
