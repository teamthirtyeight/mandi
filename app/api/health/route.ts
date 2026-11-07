import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = "not_configured";
  let jobs: Record<string, number> | null = null;
  if (process.env.DATABASE_URL) {
    try {
      const { db: client } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");
      await client.execute(sql`select 1`);
      db = "ok";
      const { queueStats } = await import("@/lib/jobs/queue");
      jobs = await queueStats().catch(() => null);
    } catch {
      db = "error";
    }
  }
  return NextResponse.json({
    status: "ok",
    db,
    paypal: process.env.PAYPAL_CLIENT_ID ? "configured" : "missing",
    // "inline": this web server also runs jobs; "web": a separate worker does.
    jobsMode: process.env.JOBS_MODE === "web" ? "web" : "inline",
    jobsLastDay: jobs,
  });
}
