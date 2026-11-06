import { describe, expect, it } from "vitest";
import { advance, canRefund, canShip, canVoid, statusForWebhook } from "@/lib/orders/state";

describe("order status machine", () => {
  it("moves forward", () => {
    expect(advance("CREATED", "AUTHORIZED")).toBe("AUTHORIZED");
    expect(advance("AUTHORIZED", "CAPTURED")).toBe("CAPTURED");
  });

  it("ignores a late webhook that would move it backwards", () => {
    // Redirect already captured; the AUTHORIZATION.CREATED webhook lands afterwards.
    expect(advance("CAPTURED", "AUTHORIZED")).toBe("CAPTURED");
  });

  it("accepts a webhook that arrives before the redirect", () => {
    expect(advance("CREATED", statusForWebhook("PAYMENT.AUTHORIZATION.CREATED")!)).toBe("AUTHORIZED");
  });

  it("voids only an uncaptured authorization", () => {
    expect(advance("AUTHORIZED", "VOIDED")).toBe("VOIDED");
    expect(advance("CAPTURED", "VOIDED")).toBe("CAPTURED");
  });

  it("treats refunded and voided as final", () => {
    expect(advance("REFUNDED", "CAPTURED")).toBe("REFUNDED");
    expect(advance("VOIDED", "AUTHORIZED")).toBe("VOIDED");
  });

  it("guards ship, void and refund", () => {
    expect(canShip("AUTHORIZED")).toBe(true);
    expect(canShip("CREATED")).toBe(false);
    expect(canVoid("CAPTURED")).toBe(false);
    expect(canRefund("CAPTURED", 7200, 0)).toBe(true);
    expect(canRefund("CAPTURED", 7200, 7200)).toBe(false);
    expect(canRefund("AUTHORIZED", 7200, 0)).toBe(false);
  });
});
