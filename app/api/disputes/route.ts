// PayPal disputes for the merchant (Agent Toolkit list_disputes), for the dashboard.
import { NextResponse } from "next/server";
import { listDisputes } from "@/lib/paypal/toolkit";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser("seller");
  } catch (err) {
    return errorResponse(err);
  }
  const disputes = await listDisputes();
  return NextResponse.json({ available: disputes !== null, disputes: disputes ?? [] });
}
