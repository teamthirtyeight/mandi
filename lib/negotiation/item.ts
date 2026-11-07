// Which item a buyer's request is for. Pure, so it can be tested on its own.

/**
 * The item a request is for: the last word of the item query ("handwoven silk
 * scarf" → scarf), matching its singular and plural (scarf, scarves, saris).
 */
export function itemNoun(query: string): RegExp | null {
  const last = (query.toLowerCase().match(/[a-z]+/g) ?? []).at(-1);
  if (!last || last.length < 3) return null;
  // Possible singulars of the word as written, then each with its plurals.
  const singulars = new Set([last]);
  if (!last.endsWith("ss")) {
    if (last.endsWith("ves")) singulars.add(`${last.slice(0, -3)}f`);
    if (last.endsWith("ies")) singulars.add(`${last.slice(0, -3)}y`);
    if (last.endsWith("es")) singulars.add(last.slice(0, -2));
    if (last.endsWith("s")) singulars.add(last.slice(0, -1));
  }
  const forms = new Set<string>();
  for (const w of singulars) {
    forms.add(w).add(`${w}s`).add(`${w}es`);
    if (w.endsWith("f")) forms.add(`${w.slice(0, -1)}ves`);
    if (w.endsWith("y")) forms.add(`${w.slice(0, -1)}ies`);
  }
  return new RegExp(`\\b(${[...forms].join("|")})\\b`, "i");
}
