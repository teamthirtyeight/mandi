// Turns of one negotiation, for the dashboard's detail panel.
import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { UUID } from "@/lib/api/errors";
import { toMajor } from "@/lib/engine/negotiation";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid negotiation id" }, { status: 400 });
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
      proposed: t.proposedPriceMinor != null ? toMajor(t.proposedPriceMinor) : null,
      final: t.finalPriceMinor != null ? toMajor(t.finalPriceMinor) : null,
      guardrail: t.guardrailResult,
      injection: t.injectionDetected,
      source: t.source,
    })),
  });
}
