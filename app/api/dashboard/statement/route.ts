// The seller's PayPal statement (Transaction Search via the Agent Toolkit), matched to Mandix's orders.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";
import { statementFor } from "@/lib/reporting";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser("seller");
    if (!user.sellerId) return NextResponse.json({ error: "No seller profile" }, { status: 403 });
    return NextResponse.json(await statementFor(user.sellerId));
  } catch (err) {
    return errorResponse(err);
  }
}
