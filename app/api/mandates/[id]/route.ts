import { NextResponse } from "next/server";
import { UUID } from "@/lib/api/errors";
import { getMandateSnapshot } from "@/lib/negotiation/snapshot";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid mandate id" }, { status: 400 });
  const snap = await getMandateSnapshot(id);
  if (!snap) return NextResponse.json({ error: "Mandate not found" }, { status: 404 });
  return NextResponse.json(snap);
}
