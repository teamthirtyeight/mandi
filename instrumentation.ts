// Runs once when the Node server starts: sweeps expired holds every 5 minutes.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { voidExpiredHolds } = await import("./lib/orders/expiry");
  const sweep = () =>
    voidExpiredHolds()
      .then((ids) => ids.length && console.info(`[expiry] voided ${ids.length} expired hold(s)`))
      .catch((err) => console.error("[expiry] sweep failed", err));
  setInterval(sweep, 5 * 60 * 1000);
  void sweep();
}
