// Buyer confirms the mandate once: find listings, open negotiations, and start
// the agents in the background. Progress streams over /api/mandates/:id/stream.
import { NextResponse } from "next/server";
import { UUID } from "@/lib/api/errors";
import { openNegotiations, runMandate } from "@/lib/negotiation/runner";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid mandate id" }, { status: 400 });

  const negotiations = await openNegotiations(id);
  if (negotiations === null) return NextResponse.json({ error: "Mandate already confirmed" }, { status: 409 });
  if (negotiations.length === 0) {
    return NextResponse.json({ error: "No sellers can deliver that by the deadline." }, { status: 404 });
  }

  // Fire and forget: the runner persists every turn and publishes it to the stream.
  void runMandate(id).catch((err) => console.error("[confirm] runner crashed", err));
  return NextResponse.json({ negotiations: negotiations.map((n) => n.id) });
}
