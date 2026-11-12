// Manual or scheduled trigger for the auto-void sweep (e.g. a Render cron job).
// Requests must send CRON_SECRET as a Bearer token; without one set, only dev may call it.
import { NextResponse } from "next/server";
import { voidExpiredHolds } from "@/lib/orders/expiry";

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret ? req.headers.get("authorization") !== `Bearer ${secret}` : process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const voided = await voidExpiredHolds();
  return NextResponse.json({ voided });
}
