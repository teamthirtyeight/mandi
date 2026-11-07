// One-off, safe to re-run: marks the seeded past sales (captured before payouts
// existed) as paid out, so "Paid to you" and its weekly chart include them.
// Run on the server: npx tsx scripts/backfill-seed-payouts.ts
import { and, isNull, like, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

(async () => {
  const rows = await db
    .update(schema.orders)
    .set({
      payoutStatus: "SUCCESS",
      payoutBatchId: sql`replace(${schema.orders.captureId}, 'SEED-CAPTURE-', 'SEED-PAYOUT-')`,
      payoutMinor: sql`round(${schema.orders.amountMinor} * 0.95)::int`,
      feeMinor: sql`${schema.orders.amountMinor} - round(${schema.orders.amountMinor} * 0.95)::int`,
      paidOutAt: schema.orders.capturedAt,
    })
    .where(and(like(schema.orders.captureId, "SEED-CAPTURE-%"), isNull(schema.orders.payoutStatus)))
    .returning({ id: schema.orders.id, payout: schema.orders.payoutMinor });
  console.log(`Marked ${rows.length} seeded order(s) as paid out`, rows);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
