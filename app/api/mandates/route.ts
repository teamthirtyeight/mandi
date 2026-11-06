// Buyer's one sentence → draft mandate (budget, deadline, ship-to, keywords).
// The buyer confirms it once before any negotiation starts.
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { parseMandate } from "@/lib/agents/mandate";

const Body = z.object({
  requestText: z.string().trim().min(5).max(300),
  buyerName: z.string().trim().min(1).max(40).default("Sarah"),
  hostile: z.boolean().default(false),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe what you want in a sentence." }, { status: 400 });

  const draft = await parseMandate(parsed.data.requestText);
  if (!draft) {
    return NextResponse.json(
      { error: "Couldn't find a budget in that. Try: \"silk scarf for my mum, under £90, by Dec 20\"." },
      { status: 422 },
    );
  }

  const [mandate] = await db
    .insert(schema.mandates)
    .values({
      buyerName: parsed.data.buyerName,
      requestText: parsed.data.requestText,
      query: draft.item_query,
      maxPriceMinor: Math.round(draft.max_price * 100),
      currency: draft.currency,
      deadline: draft.deadline,
      shipToCountry: draft.ship_to_country,
      hostile: parsed.data.hostile,
    })
    .returning();

  return NextResponse.json({
    id: mandate.id,
    query: mandate.query,
    maxPrice: draft.max_price,
    currency: mandate.currency,
    deadline: mandate.deadline,
    shipToCountry: mandate.shipToCountry,
    hostile: mandate.hostile,
  });
}
