// One-click "Try the demo": Sarah's mandate, confirmed, agents started.
// Capped so a burst of judges can't run up unbounded model spend.
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { openNegotiations, runMandate } from "@/lib/negotiation/runner";

const DEMO_REQUEST = "Handwoven silk scarf for my mum, under £90, by Dec 20";
const MAX_RUNNING = 5;

function nextDec20(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), 11, 20));
  if (d.getTime() - now.getTime() < 14 * 86400000) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const hostile = new URL(req.url).searchParams.get("hostile") === "1";

  const [{ running }] = await db
    .select({ running: sql<number>`count(*)::int` })
    .from(schema.mandates)
    .where(eq(schema.mandates.status, "negotiating"));
  if (running >= MAX_RUNNING) {
    return NextResponse.json({ error: "A few demos are running right now. Try again in a minute." }, { status: 429 });
  }

  const [mandate] = await db
    .insert(schema.mandates)
    .values({
      buyerName: "Sarah",
      requestText: DEMO_REQUEST,
      query: "handwoven silk scarf",
      maxPriceMinor: 9000,
      currency: "GBP",
      deadline: nextDec20(),
      shipToCountry: "GB",
      hostile,
    })
    .returning();

  const negs = await openNegotiations(mandate.id);
  if (!negs || negs.length === 0) {
    return NextResponse.json({ error: "No demo listings found. Run the seed script." }, { status: 404 });
  }
  void runMandate(mandate.id).catch((err) => console.error("[demo] runner crashed", err));
  return NextResponse.json({ mandateId: mandate.id });
}
