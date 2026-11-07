// Server-Sent Events for the negotiation room. Sends a snapshot first, then
// every turn, state change and the final recommendation as they happen.
import { UUID } from "@/lib/api/errors";
import { ready, subscribe, type MandiEvent } from "@/lib/negotiation/bus";
import { getMandateSnapshot } from "@/lib/negotiation/snapshot";
import { AuthError, requireUser } from "@/lib/auth/session";
import { assertMandateOwner } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

const FINAL = new Set(["recommended", "no_deal", "no_match", "failed", "interrupted", "cancelled"]);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Invalid mandate id", { status: 400 });
  try {
    await assertMandateOwner(await requireUser("buyer"), id);
  } catch (err) {
    return new Response(err instanceof AuthError ? err.message : "Error", { status: err instanceof AuthError ? err.status : 500 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };

      // Subscribe before reading the snapshot so nothing falls in the gap;
      // the client de-duplicates turns by id.
      const buffered: MandiEvent[] = [];
      let live = false;
      const unsubscribe = subscribe(id, (e) => {
        if (!live) return void buffered.push(e);
        send(e.type, e);
        if (e.type === "done") close();
      });
      const ping = setInterval(() => send("ping", {}), 15000);
      cleanup = () => {
        unsubscribe();
        clearInterval(ping);
      };
      req.signal.addEventListener("abort", close);

      await ready(); // listening before the snapshot, so no event falls in the gap
      const snap = await getMandateSnapshot(id);
      if (!snap) {
        send("error", { error: "Mandate not found" });
        return close();
      }
      send("snapshot", snap);
      live = true;
      for (const e of buffered) send(e.type, e);
      if (FINAL.has(snap.mandate.status)) close();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stops reverse proxies (nginx-style, as on many hosts) buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
