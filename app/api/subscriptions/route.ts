// Mandi Monthly for the signed-in buyer: see it (GET), start it (POST, returns
// PayPal's approval link), or cancel it (DELETE). All through the Agent Toolkit.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";
import { cancelSubscription, currentSubscription, monthArtisan, MONTHLY_PRICE_USD, subscribe } from "@/lib/subscriptions";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function artisanView() {
  const a = await monthArtisan();
  return a ? { name: a.name, city: a.city, craft: a.craft, quote: a.quote, photoUrl: a.photoUrl, photoCredit: a.photoCredit } : null;
}

export async function GET() {
  try {
    const user = await requireUser("buyer").catch(() => null);
    const sub = user ? await currentSubscription(user.id).catch(() => null) : null;
    return NextResponse.json({
      price: MONTHLY_PRICE_USD,
      currency: "USD",
      artisan: await artisanView(),
      subscription: sub ? { id: sub.paypalSubscriptionId, status: sub.status, approveUrl: sub.approveUrl } : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST() {
  try {
    const user = await requireUser("buyer");
    const [u] = await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, user.id));
    const current = await currentSubscription(user.id);
    if (current && ["ACTIVE", "APPROVED"].includes(current.status)) {
      return NextResponse.json({ error: "You're already subscribed." }, { status: 409 });
    }
    const sub = await subscribe({ id: user.id, name: user.name, email: u.email });
    if (!sub.approveUrl) return NextResponse.json({ error: "PayPal didn't return an approval link." }, { status: 502 });
    return NextResponse.json(sub);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser("buyer");
    const sub = await cancelSubscription(user.id);
    return NextResponse.json({ status: sub?.status ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
