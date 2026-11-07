// Background worker: `npm run worker`. Runs negotiations and WhatsApp alerts
// from the job queue (lib/jobs). Run as many as you like; each claims jobs
// safely. Stops cleanly on SIGTERM (Render sends it on deploy), finishing
// what it has started.
import { recoverDeadJobs, startWorker } from "@/lib/jobs/worker";

(async () => {
  await recoverDeadJobs().catch((err) => console.error("[worker] startup sweep failed", err));
  const worker = startWorker();
  const shutdown = async (signal: string) => {
    console.info(`[worker] ${signal}: finishing running jobs`);
    await worker.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
})();
