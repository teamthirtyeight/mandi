// The buyer calls off a request. Running agents stop at their next turn;
// nothing is charged. Not allowed once a deal's money is held (void it instead).
import { NextResponse } from "next/server";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { errorResponse, UUID } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/session";
import { assertMandateOwner } from "@/lib/auth/access";
import { publish } from "@/lib/negotiation/bus";

const CANCELLABLE = ["draft", "confirmed", "negotiating", "recommended", "no_deal", "no_match"];

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
  try {
    await assertMandateOwner(await requireUser("buyer"), id);
    const held = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .innerJoin(schema.negotiations, eq(schema.negotiations.id, schema.orders.negotiationId))
      .where(and(eq(schema.negotiations.mandateId, id), inArray(schema.orders.status, ["AUTHORIZED", "SHIPPED", "CAPTURED"])));
    if (held.length) return NextResponse.json({ error: "You've already paid for a deal from this request." }, { status: 409 });

    const [m] = await db
      .update(schema.mandates)
      .set({ status: "cancelled" })
      .where(and(eq(schema.mandates.id, id), inArray(schema.mandates.status, CANCELLABLE)))
      .returning({ id: schema.mandates.id });
    if (!m) return NextResponse.json({ error: "This request can't be cancelled now." }, { status: 409 });

    const closed = await db
      .update(schema.negotiations)
      .set({ state: "WALKED_AWAY", outcomeReason: "buyer cancelled", agreedPriceMinor: null })
      .where(
        and(
          eq(schema.negotiations.mandateId, id),
          notInArray(schema.negotiations.state, ["WALKED_AWAY", "EXPIRED", "BLOCKED_BY_GUARDRAIL", "ORDERED"]),
        ),
      )
      .returning({ id: schema.negotiations.id });
    for (const n of closed) {
      publish(id, { type: "state", negotiation_id: n.id, state: "WALKED_AWAY", agreed_price: null, reason: "buyer cancelled" });
    }
    publish(id, { type: "done", mandate_id: id, status: "cancelled" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
