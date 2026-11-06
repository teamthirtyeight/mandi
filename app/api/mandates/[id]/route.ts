import { NextResponse } from "next/server";
import { UUID } from "@/lib/api/errors";
import { getMandateSnapshot } from "@/lib/negotiation/snapshot";
import { requireUser } from "@/lib/auth/session";
import { assertMandateOwner } from "@/lib/auth/access";
import { errorResponse } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid mandate id" }, { status: 400 });
  try {
    await assertMandateOwner(await requireUser("buyer"), id);
  } catch (err) {
    return errorResponse(err);
  }
  const snap = await getMandateSnapshot(id);
  if (!snap) return NextResponse.json({ error: "Mandate not found" }, { status: 404 });
  return NextResponse.json(snap);
}
