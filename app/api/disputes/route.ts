// PayPal disputes for the merchant (Agent Toolkit list_disputes), for the dashboard.
import { NextResponse } from "next/server";
import { listDisputes } from "@/lib/paypal/toolkit";

export const dynamic = "force-dynamic";

export async function GET() {
  const disputes = await listDisputes();
  return NextResponse.json({ available: disputes !== null, disputes: disputes ?? [] });
}
