// The requested item must match: "silk scarf" never brings back a silk cushion cover.
import { describe, expect, it } from "vitest";
import { itemNoun } from "@/lib/negotiation/item";

const matches = (query: string, title: string) => itemNoun(query)!.test(title);

describe("the requested item", () => {
  it("matches singular and plural titles", () => {
    expect(matches("handwoven silk scarf", "Indigo block-printed silk scarf")).toBe(true);
    expect(matches("silk scarves", "Handwoven Banarasi silk scarf, rose and gold")).toBe(true);
    expect(matches("handwoven silk scarf", "Sozni-embroidered silk-wool scarves")).toBe(true);
    expect(matches("embroidered wool shawl", "Embroidered wool shawl")).toBe(true);
    expect(matches("kanjivaram sarees", "Kanjivaram silk saree")).toBe(true);
    expect(matches("block printed tablecloth", "Block-printed cotton tablecloth")).toBe(true);
    expect(matches("silk dress", "Silk dresses")).toBe(true);
  });
  it("rejects other items made of the same thing", () => {
    expect(matches("handwoven silk scarf", "Handwoven silk cushion cover")).toBe(false);
    expect(matches("embroidered wool shawl", "Ahir embroidered cushion cover")).toBe(false);
    expect(matches("silk scarf", "Scarlet silk pouch")).toBe(false);
  });
  it("ignores tiny or empty queries", () => {
    expect(itemNoun("")).toBeNull();
    expect(itemNoun("a b")).toBeNull();
  });
});
