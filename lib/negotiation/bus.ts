// In-process event bus between the negotiation runner and the SSE stream.
// One Render instance runs the app, so process memory is enough.
import { EventEmitter } from "node:events";

export type MandiEvent =
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
      source: string;
      state: string;
      round: number;
      created_at: string;
    }
  | { type: "state"; negotiation_id: string; state: string; agreed_price: number | null; reason: string | null }
  | { type: "recommendation"; mandate_id: string; recommendation: unknown }
  | { type: "done"; mandate_id: string; status: string };

const g = globalThis as unknown as { mandiBus?: EventEmitter };
const bus = (g.mandiBus ??= new EventEmitter().setMaxListeners(200));

export const channel = (mandateId: string) => `mandate:${mandateId}`;
export const publish = (mandateId: string, event: MandiEvent) => bus.emit(channel(mandateId), event);
export function subscribe(mandateId: string, fn: (e: MandiEvent) => void): () => void {
  bus.on(channel(mandateId), fn);
  return () => bus.off(channel(mandateId), fn);
}
