// Negotiations run inside the web server. If it restarts mid-run, a request
// would stay "negotiating" forever. This marks such runs interrupted and closes
// their open negotiations, so the room can say so and the demo limit frees up.
import { and, eq, inArray, lt, notInArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { publish } from "./bus";

const TERMINAL = ["AGREED", "AWAITING_BUYER_APPROVAL", "ORDERED", "WALKED_AWAY", "EXPIRED", "BLOCKED_BY_GUARDRAIL"] as const;

/** A healthy run finishes in well under a minute; anything older is stuck. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

export async function recoverStuckRuns(olderThanMs = STUCK_AFTER_MS, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - olderThanMs);
  const stuck = await db
    .update(schema.mandates)
    .set({ status: "interrupted" })
    .where(and(eq(schema.mandates.status, "negotiating"), lt(schema.mandates.createdAt, cutoff)))
    .returning({ id: schema.mandates.id });
  const ids = stuck.map((m) => m.id);
  if (ids.length === 0) return [];

  await db
    .update(schema.negotiations)
    .set({ state: "EXPIRED", outcomeReason: "interrupted" })
    .where(and(inArray(schema.negotiations.mandateId, ids), notInArray(schema.negotiations.state, [...TERMINAL])));
  for (const id of ids) publish(id, { type: "done", mandate_id: id, status: "interrupted" });
  return ids;
}
