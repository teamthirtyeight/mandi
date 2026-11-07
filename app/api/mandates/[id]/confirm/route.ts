// Buyer confirms the mandate once: find listings, open negotiations, and start
// the agents in the background. Progress streams over /api/mandates/:id/stream.
import { NextResponse } from "next/server";
import { UUID } from "@/lib/api/errors";
import { openNegotiations } from "@/lib/negotiation/runner";
import { enqueue } from "@/lib/jobs/queue";
import { requireUser } from "@/lib/auth/session";
import { assertMandateOwner } from "@/lib/auth/access";
import { errorResponse } from "@/lib/api/errors";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid mandate id" }, { status: 400 });

  try {
    await assertMandateOwner(await requireUser("buyer"), id);
  } catch (err) {
    return errorResponse(err);
  }
  const negotiations = await openNegotiations(id);
  if (negotiations === null) return NextResponse.json({ error: "Mandate already confirmed" }, { status: 409 });
  if (negotiations.length === 0) {
    return NextResponse.json({ error: "No sellers can deliver that by the deadline." }, { status: 404 });
  }

  // A worker runs the negotiation; it persists every turn and publishes it to the stream.
  await enqueue("negotiate", { mandateId: id }, { maxAttempts: 1 });
  return NextResponse.json({ negotiations: negotiations.map((n) => n.id) });
}
