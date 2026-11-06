// One-click "Try the demo": Sarah's mandate, confirmed, agents started.
// Capped so a burst of judges can't run up unbounded model spend.
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { openNegotiations, runMandate } from "@/lib/negotiation/runner";
import { getUser, startSession } from "@/lib/auth/session";
import { DEMO_ACCOUNTS } from "@/lib/auth/demo";

const DEMO_REQUEST = "Handwoven silk scarf for my mum, under £90, by Dec 20";
const MAX_RUNNING = 5;

function nextDec20(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), 11, 20));
  if (d.getTime() - now.getTime() < 14 * 86400000) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  // hostile=1: buyer tries to extract the floor. hostile=2: also simulates a seller
  // agent that falls for it, so the engine's blocks show on camera.
  const mode = new URL(req.url).searchParams.get("hostile");
  const hostile = mode === "1" || mode === "2";
  const compromised = mode === "2";

  // Logged-out visitors (judges) run the demo as Sarah, the demo buyer.
  let user = await getUser();
  if (user && user.role !== "buyer") {
    return NextResponse.json({ error: "Log out of the seller account to try the buyer demo." }, { status: 403 });
  }
  if (!user) {
    if (process.env.DEMO_LOGINS === "0") return NextResponse.json({ error: "Please log in as a buyer" }, { status: 401 });
    [user] = await db.select().from(schema.users).where(eq(schema.users.email, DEMO_ACCOUNTS.sarah.email));
    if (!user) return NextResponse.json({ error: "Demo accounts aren't seeded. Run npm run db:seed." }, { status: 404 });
    await startSession(user.id);
  }

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
      buyerName: user.name,
      buyerUserId: user.id,
      requestText: DEMO_REQUEST,
      query: "handwoven silk scarf",
      maxPriceMinor: 9000,
      currency: "GBP",
      deadline: nextDec20(),
      shipToCountry: "GB",
      hostile,
      compromised,
    })
    .returning();

  const negs = await openNegotiations(mandate.id);
  if (!negs || negs.length === 0) {
    return NextResponse.json({ error: "No demo listings found. Run the seed script." }, { status: 404 });
  }
  void runMandate(mandate.id).catch((err) => console.error("[demo] runner crashed", err));
  return NextResponse.json({ mandateId: mandate.id });
}
