// Seller picker for onboarding (demo: the seeded sandbox sellers).
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const sellers = await db
    .select({ id: schema.sellers.id, name: schema.sellers.name, city: schema.sellers.city })
    .from(schema.sellers)
    .orderBy(asc(schema.sellers.createdAt));
  return NextResponse.json({ sellers });
}
