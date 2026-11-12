// Turns of one negotiation, for the dashboard's detail panel.
import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { errorResponse, UUID } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { assertNegotiationAccess } from "@/lib/auth/access";
import { shownProposedMinor, toMajor, type Actor } from "@/lib/engine/negotiation";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid negotiation id" }, { status: 400 });
  let viewer: Actor;
  try {
    const user = await requireUser();
    await assertNegotiationAccess(user, id, "either");
    viewer = user.role as Actor;
  } catch (err) {
    return errorResponse(err);
  }
  const shown = (t: Parameters<typeof shownProposedMinor>[0]) => shownProposedMinor(t, viewer);
  const turns = await db
    .select()
    .from(schema.negotiationTurns)
    .where(eq(schema.negotiationTurns.negotiationId, id))
    .orderBy(asc(schema.negotiationTurns.createdAt));
  return NextResponse.json({
    turns: turns.map((t) => ({
      id: t.id,
      from: t.actor,
      round: t.round,
      message: t.message,
      proposed: shown(t) != null ? toMajor(shown(t)!) : null,
      final: t.finalPriceMinor != null ? toMajor(t.finalPriceMinor) : null,
      guardrail: t.guardrailResult,
      injection: t.injectionDetected,
      source: t.source,
    })),
  });
}
