// Event bus between the negotiation runner and the SSE stream.
//
// The runner may be in a worker process and the buyer's stream on any web
// server, so events travel through Postgres NOTIFY: every process LISTENs on
// one channel and hands events to its local subscribers. If LISTEN isn't
// available (no database, or a pooler that blocks it), events stay in-process,
// which is enough when one process does everything.
import { EventEmitter } from "node:events";

export type MandixEvent =
  | {
      type: "turn";
      id: string;
      negotiation_id: string;
      seller: string;
      from: "buyer" | "seller" | "engine";
      message: string;
      proposed_price: number | null;
      final_price: number | null;
      guardrail_result: string;
      injection: boolean;
      limit_redacted: boolean;
      source: string;
      state: string;
      round: number;
      created_at: string;
    }
  | { type: "state"; negotiation_id: string; state: string; agreed_price: number | null; reason: string | null }
  | { type: "recommendation"; mandate_id: string; recommendation: unknown }
  | { type: "done"; mandate_id: string; status: string };

const g = globalThis as unknown as { mandixBus?: EventEmitter; mandixBusListen?: Promise<boolean> };
const bus = (g.mandixBus ??= new EventEmitter().setMaxListeners(500));

export const EVENTS_CHANNEL = "mandix_events";
// NOTIFY payloads must stay under 8000 bytes; long agent messages are trimmed.
const MAX_MESSAGE = 3000;

export const channel = (mandateId: string) => `mandate:${mandateId}`;

/** Starts this process's LISTEN once. Resolves true if events cross processes. */
function listen(): Promise<boolean> {
  return (g.mandixBusListen ??= (async () => {
    if (!process.env.DATABASE_URL) return false;
    try {
      const { pg } = await import("@/lib/db");
      await pg.listen(EVENTS_CHANNEL, (raw) => {
        try {
          const { m, e } = JSON.parse(raw) as { m: string; e: MandixEvent };
          bus.emit(channel(m), e);
        } catch (err) {
          console.error("[bus] bad event", err);
        }
      });
      return true;
    } catch (err) {
      console.warn("[bus] LISTEN unavailable, events stay in this process", (err as Error).message);
      return false;
    }
  })());
}

// One chain per process, so events go out in the order they were published
// (the "done" event never overtakes the last turn).
let chain: Promise<void> = Promise.resolve();

export function publish(mandateId: string, event: MandixEvent): void {
  const e = event.type === "turn" && event.message.length > MAX_MESSAGE ? { ...event, message: `${event.message.slice(0, MAX_MESSAGE)}…` } : event;
  chain = chain.then(() => send(mandateId, e));
}

async function send(mandateId: string, e: MandixEvent): Promise<void> {
  await (async () => {
    if (await listen()) {
      const { pg } = await import("@/lib/db");
      // Our own LISTEN delivers it back to local subscribers too.
      await pg.notify(EVENTS_CHANNEL, JSON.stringify({ m: mandateId, e }));
    } else {
      bus.emit(channel(mandateId), e);
    }
  })().catch((err) => {
    console.error("[bus] publish failed, delivering locally", err);
    bus.emit(channel(mandateId), e);
  });
}

/** Resolves when every event published so far has gone out (tests, shutdown). */
export const flushed = () => chain;

export function subscribe(mandateId: string, fn: (e: MandixEvent) => void): () => void {
  void listen();
  bus.on(channel(mandateId), fn);
  return () => bus.off(channel(mandateId), fn);
}

/** Resolves once this process is listening (tests, and the stream before its snapshot). */
export const ready = () => listen();
