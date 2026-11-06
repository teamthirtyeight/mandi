// Order status machine. Pure functions only, shared by the order service and
// the webhook listener so a webhook arriving before (or after) the browser
// redirect can never move an order backwards.
export type OrderStatus = "CREATED" | "APPROVED" | "AUTHORIZED" | "SHIPPED" | "CAPTURED" | "REFUNDED" | "VOIDED";

const RANK: Record<OrderStatus, number> = {
  CREATED: 0,
  APPROVED: 1,
  AUTHORIZED: 2,
  SHIPPED: 3,
  CAPTURED: 4,
  REFUNDED: 5,
  VOIDED: 5,
};

/** Status after an event, or the current status if the event is stale or out of order. */
export function advance(current: OrderStatus, next: OrderStatus): OrderStatus {
  if (current === "VOIDED" || current === "REFUNDED") return current;
  if (next === "VOIDED") return current === "AUTHORIZED" || current === "APPROVED" ? "VOIDED" : current;
  return RANK[next] > RANK[current] ? next : current;
}

export const canShip = (s: OrderStatus) => s === "AUTHORIZED";
export const canVoid = (s: OrderStatus) => s === "AUTHORIZED";
export const canRefund = (s: OrderStatus, amountMinor: number, refundedMinor: number) =>
  s === "CAPTURED" && refundedMinor < amountMinor;

/** Map a PayPal webhook event type to the order status it implies. */
export function statusForWebhook(eventType: string): OrderStatus | null {
  switch (eventType) {
    case "CHECKOUT.ORDER.APPROVED":
      return "APPROVED";
    case "PAYMENT.AUTHORIZATION.CREATED":
      return "AUTHORIZED";
    case "PAYMENT.AUTHORIZATION.VOIDED":
      return "VOIDED";
    case "PAYMENT.CAPTURE.COMPLETED":
      return "CAPTURED";
    default:
      return null;
  }
}
