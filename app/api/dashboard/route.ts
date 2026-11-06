// Seller dashboard data for the logged-in seller (their own floors included).
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { getDashboard } from "@/lib/dashboard/data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser("seller");
    const data = await getDashboard(user.sellerId!);
    if (!data) return NextResponse.json({ error: "Seller not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}
