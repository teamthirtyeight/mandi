import { NextResponse } from "next/server";
import { getCatalogItem } from "@/lib/catalog";
import { UUID } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid listing id" }, { status: 400 });
  const item = await getCatalogItem(id);
  if (!item || item.status === "paused") return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  return NextResponse.json({ item });
}
