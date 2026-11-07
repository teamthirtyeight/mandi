// Runs queued jobs. Started either by `npm run worker` (a separate process,
// so negotiations never slow the website and survive web deploys), or inside
// the web server when JOBS_MODE isn't "web" (one-server setups, dev, tests).
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { and, eq } from "drizzle-orm";
import { db, pg, schema } from "@/lib/db";
import { publish } from "@/lib/negotiation/bus";
import { claimNext, complete, fail, heartbeat, JOBS_CHANNEL, reapStale, type Job, type JobKind } from "./queue";

const HEARTBEAT_MS = 15_000;
const POLL_MS = 3_000;

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const handlers: Record<JobKind, Handler> = {
  async negotiate(p) {
    const { runMandate } = await import("@/lib/negotiation/runner");
    await runMandate(String(p.mandateId));
  },
  async whatsapp(p) {
    const { preparedBannerUrl } = await import("@/lib/banner-data");
    const { sendWhatsApp } = await import("@/lib/whatsapp");
    const mediaUrl = p.banner ? await preparedBannerUrl(String(p.banner), String(p.orderId), Number(p.extra ?? 0)) : null;
    const sent = await sendWhatsApp({ sellerId: String(p.sellerId), orderId: (p.orderId as string) ?? null, to: String(p.to), body: String(p.body), mediaUrl });
    // Twilio refused or timed out: let the queue retry it.
    if (sent.status === "failed") throw new Error(sent.error ?? "WhatsApp send failed");
  },
};

/** Runs one claimed job with a heartbeat. Exported for tests. */
export async function runJob(job: Job, workerId: string): Promise<void> {
  const beat = setInterval(() => void heartbeat(job.id, workerId).catch(() => {}), HEARTBEAT_MS);
  try {
    const handler = handlers[job.kind as JobKind];
    if (!handler) throw new Error(`Unknown job kind ${job.kind}`);
    await handler(job.payload);
    await complete(job.id);
  } catch (err) {
    console.error(`[jobs] ${job.kind} ${job.id} failed (attempt ${job.attempts})`, err);
    await fail(job, err);
  } finally {
    clearInterval(beat);
  }
}

/**
 * Jobs whose worker died. A negotiation can't pick up mid-conversation, so its
 * request is closed as interrupted (the room tells the buyer, nothing was
 * charged). Other kinds were marked failed and are queued again once.
 */
export async function recoverDeadJobs(): Promise<number> {
  const dead = await reapStale();
  for (const job of dead) {
    if (job.kind === "negotiate") {
      const mandateId = String(job.payload.mandateId);
      const [m] = await db
        .update(schema.mandates)
        .set({ status: "interrupted" })
        .where(and(eq(schema.mandates.id, mandateId), eq(schema.mandates.status, "negotiating")))
        .returning({ id: schema.mandates.id });
      if (m) publish(mandateId, { type: "done", mandate_id: mandateId, status: "interrupted" });
    } else if (job.attempts < job.maxAttempts) {
      await db.update(schema.jobs).set({ status: "queued", runAfter: new Date() }).where(eq(schema.jobs.id, job.id));
    }
  }
  return dead.length;
}

export interface WorkerHandle {
  id: string;
  stop: () => Promise<void>;
}

/** Starts a worker loop. `concurrency` jobs run at once in this process. */
export function startWorker(opts: { concurrency?: number; kinds?: readonly JobKind[] } = {}): WorkerHandle {
  const id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const concurrency = opts.concurrency ?? Number(process.env.JOBS_CONCURRENCY ?? 4);
  let running = 0;
  let stopping = false;
  let wake: (() => void) | null = null;
  const inFlight = new Set<Promise<void>>();

  const nudge = () => wake?.();
  const listening = pg.listen(JOBS_CHANNEL, nudge).catch((err) => {
    console.warn("[jobs] LISTEN unavailable, polling only", err?.message);
    return null;
  });
  const reaper = setInterval(() => void recoverDeadJobs().catch((err) => console.error("[jobs] reaper failed", err)), STALE_CHECK_MS);

  const loop = async () => {
    while (!stopping) {
      if (running >= concurrency) {
        await new Promise<void>((r) => (wake = r));
        continue;
      }
      const job = await claimNext(id, opts.kinds).catch((err) => {
        console.error("[jobs] claim failed", err);
        return null;
      });
      if (!job) {
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, POLL_MS);
        });
        continue;
      }
      running++;
      const p = runJob(job, id).finally(() => {
        running--;
        inFlight.delete(p);
        nudge();
      });
      inFlight.add(p);
    }
  };
  void loop();
  console.info(`[jobs] worker ${id} started (concurrency ${concurrency})`);

  return {
    id,
    async stop() {
      stopping = true;
      nudge();
      clearInterval(reaper);
      await Promise.allSettled([...inFlight]);
      const sub = await listening;
      await sub?.unlisten().catch(() => {});
    },
  };
}

const STALE_CHECK_MS = 30_000;
