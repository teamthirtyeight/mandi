// Runs once when the Node server starts.
//
// Background jobs (negotiations, WhatsApp alerts) run in a worker. With
// JOBS_MODE=web, a separate `npm run worker` process does that and this web
// server only queues them; otherwise (one-server setups, dev) this server
// starts a worker too. Every 5 minutes: void expired holds and close any run
// that hung.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { voidExpiredHolds } = await import("./lib/orders/expiry");
  const { recoverStuckRuns } = await import("./lib/negotiation/recovery");

  if (process.env.JOBS_MODE !== "web") {
    const { recoverDeadJobs, startWorker } = await import("./lib/jobs/worker");
    await recoverDeadJobs().catch((err) => console.error("[jobs] startup sweep failed", err));
    startWorker();
  }

  const sweep = () =>
    Promise.all([voidExpiredHolds(), recoverStuckRuns()])
      .then(([voided]) => voided)
      .then((ids) => ids.length && console.info(`[expiry] voided ${ids.length} expired hold(s)`))
      .catch((err) => console.error("[expiry] sweep failed", err));
  setInterval(sweep, 5 * 60 * 1000);
  void sweep();
}
