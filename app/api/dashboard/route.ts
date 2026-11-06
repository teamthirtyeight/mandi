// Seller dashboard data. ?sellerId= picks the seller (default: the first one).
// No auth in the demo: the dashboard shows the seller's own floor prices.
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { UUID } from "@/lib/api/errors";
import { getDashboard } from "@/lib/dashboard/data";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let sellerId = new URL(req.url).searchParams.get("sellerId");
  if (sellerId && !UUID.test(sellerId)) return NextResponse.json({ error: "Invalid seller id" }, { status: 400 });
  if (!sellerId) {
    const [first] = await db.select({ id: schema.sellers.id }).from(schema.sellers).orderBy(asc(schema.sellers.createdAt)).limit(1);
    if (!first) return NextResponse.json({ error: "No sellers" }, { status: 404 });
    sellerId = first.id;
  }
  const data = await getDashboard(sellerId);
  if (!data) return NextResponse.json({ error: "Seller not found" }, { status: 404 });
  return NextResponse.json(data);
}
