// The seller's PayPal disputes (Agent Toolkit list_disputes), for the dashboard.
import { NextResponse } from "next/server";
import { listDisputes, sellerCaptureIds } from "@/lib/paypal/toolkit";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  let sellerId: string;
  try {
    sellerId = (await requireUser("seller")).sellerId!;
  } catch (err) {
    return errorResponse(err);
  }
  const disputes = await listDisputes();
  // The merchant account is shared: a seller sees only disputes on their own captures.
  const mine = new Set(await sellerCaptureIds(sellerId));
  return NextResponse.json({ available: disputes !== null, disputes: (disputes ?? []).filter((d) => d.transactionId && mine.has(d.transactionId)) });
}
