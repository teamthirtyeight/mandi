// A small job queue on Postgres: no extra service. Any number of worker
// processes can claim jobs safely (FOR UPDATE SKIP LOCKED); a running job
// sends a heartbeat, so a job whose worker died is noticed within a minute.
import { and, eq, lt, sql } from "drizzle-orm";
import { db, pg, schema } from "@/lib/db";

// Times are written from the app's clock, never the database's now(): the
// columns have no time zone, and the database's local zone may differ.

export type Job = typeof schema.jobs.$inferSelect;
export type JobKind = "negotiate" | "whatsapp";

export const JOBS_CHANNEL = "mandi_jobs";
/** A running job whose heartbeat is older than this has lost its worker. */
export const STALE_AFTER_MS = 60_000;

export async function enqueue(kind: JobKind, payload: Record<string, unknown>, opts: { maxAttempts?: number } = {}): Promise<Job> {
  const [job] = await db
    .insert(schema.jobs)
    .values({ kind, payload, maxAttempts: opts.maxAttempts ?? 3, runAfter: new Date(), createdAt: new Date() })
    .returning();
  // Wake idle workers at once; they also poll, so a lost notification only delays.
  await pg.notify(JOBS_CHANNEL, job.id).catch(() => {});
  return job;
}

/** Claims the oldest job that's due, or null. */
export async function claimNext(workerId: string, kinds?: readonly JobKind[]): Promise<Job | null> {
  const kindFilter = kinds?.length ? sql`and kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``;
  // Same format drizzle writes for these columns: the UTC time, no zone.
  const now = new Date().toISOString();
  const rows = await db.execute<Job>(sql`
    update jobs set status = 'running', locked_by = ${workerId}, heartbeat_at = ${now}::timestamp, attempts = attempts + 1
    where id = (
      select id from jobs
      where status = 'queued' and run_after <= ${now}::timestamp ${kindFilter}
      order by created_at
      for update skip locked
      limit 1
    )
    returning id, kind, payload, status, attempts, max_attempts as "maxAttempts", run_after as "runAfter",
      locked_by as "lockedBy", heartbeat_at as "heartbeatAt", last_error as "lastError", created_at as "createdAt", finished_at as "finishedAt"`);
  return (rows as unknown as Job[])[0] ?? null;
}

export async function heartbeat(jobId: string, workerId: string) {
  await db
    .update(schema.jobs)
    .set({ heartbeatAt: new Date() })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.lockedBy, workerId), eq(schema.jobs.status, "running")));
}

export async function complete(jobId: string) {
  await db.update(schema.jobs).set({ status: "done", finishedAt: new Date(), lockedBy: null }).where(eq(schema.jobs.id, jobId));
}

/** A failed attempt: retried later with backoff, or failed for good after maxAttempts. */
export async function fail(job: Job, err: unknown) {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
  const final = job.attempts >= job.maxAttempts;
  await db
    .update(schema.jobs)
    .set(
      final
        ? { status: "failed", lastError: message, finishedAt: new Date(), lockedBy: null }
        : { status: "queued", lastError: message, lockedBy: null, runAfter: new Date(Date.now() + 2 ** job.attempts * 5_000) },
    )
    .where(eq(schema.jobs.id, job.id));
  return final;
}

/**
 * Running jobs whose worker stopped sending heartbeats. Returned so the caller
 * can decide per kind: retry it, or (for a negotiation, which can't resume)
 * close it as interrupted.
 */
export async function reapStale(now = new Date()): Promise<Job[]> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  return db
    .update(schema.jobs)
    .set({ status: "failed", lastError: "worker stopped", finishedAt: now, lockedBy: null })
    .where(and(eq(schema.jobs.status, "running"), lt(schema.jobs.heartbeatAt, cutoff)))
    .returning();
}

/** Counts for the health check. */
export async function queueStats() {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = await db.execute<{ status: string; n: number }>(sql`select status, count(*)::int as n from jobs where created_at > ${since}::timestamp group by status`);
  return Object.fromEntries((rows as unknown as { status: string; n: number }[]).map((r) => [r.status, r.n]));
}
