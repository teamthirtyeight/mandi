// Buyer's one sentence → draft mandate (budget, deadline, ship-to, keywords).
// The buyer confirms it once before any negotiation starts.
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { parseMandate } from "@/lib/agents/mandate";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";

const Body = z.object({
  requestText: z.string().trim().min(5).max(300),
  hostile: z.boolean().default(false),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser("buyer");
  } catch (err) {
    return errorResponse(err);
  }
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
      buyerName: user.name,
      buyerUserId: user.id,
      requestText: parsed.data.requestText,
      query: draft.item_query,
      maxPriceMinor: Math.round(draft.max_price * 100),
      currency: draft.currency,
      deadline: draft.deadline,
      // The sentence wins if it names a country; otherwise the buyer's default.
      shipToCountry: /\b(ship|deliver|send)\w*\b.*\bto\b/i.test(parsed.data.requestText) ? draft.ship_to_country : user.shipToCountry,
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
