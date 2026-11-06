import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = "not_configured";
  if (process.env.DATABASE_URL) {
    try {
      const { db: client } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");
      await client.execute(sql`select 1`);
      db = "ok";
    } catch {
      db = "error";
    }
  }
  return NextResponse.json({ status: "ok", db, paypal: process.env.PAYPAL_CLIENT_ID ? "configured" : "missing" });
}
