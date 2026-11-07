// Runs once when the Node server starts. Negotiations from before the restart
// can't still be running, so they're marked interrupted straight away; then
// every 5 minutes: void expired holds and catch any run that hung.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { voidExpiredHolds } = await import("./lib/orders/expiry");
  const { recoverStuckRuns } = await import("./lib/negotiation/recovery");
  await recoverStuckRuns(0)
    .then((ids) => ids.length && console.info(`[recovery] marked ${ids.length} interrupted run(s)`))
    .catch((err) => console.error("[recovery] startup sweep failed", err));
  const sweep = () =>
    Promise.all([voidExpiredHolds(), recoverStuckRuns()])
      .then(([voided]) => voided)
      .then((ids) => ids.length && console.info(`[expiry] voided ${ids.length} expired hold(s)`))
      .catch((err) => console.error("[expiry] sweep failed", err));
  setInterval(sweep, 5 * 60 * 1000);
  void sweep();
}
