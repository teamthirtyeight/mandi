// Writes every PayPal call and webhook to paypal_events, which feeds the
// on-screen "PayPal API calls" panel. Logging must never break a money call.
export interface PaypalEventInput {
  orderId?: string | null;
  direction: "call" | "webhook";
  method?: string;
  endpoint: string;
  httpStatus?: number;
  summary: string;
}

export async function logPaypalEvent(event: PaypalEventInput): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.info("[paypal]", event.method ?? "", event.endpoint, event.httpStatus ?? "", event.summary);
    return;
  }
  try {
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.paypalEvents).values({
      orderId: event.orderId ?? null,
      direction: event.direction,
      method: event.method,
      endpoint: event.endpoint,
      httpStatus: event.httpStatus,
      summary: event.summary,
    });
  } catch (err) {
    console.error("[paypal] failed to log event", err);
  }
}
