import { describe, expect, it, vi } from "vitest";
import { createSimulatedVerifier, verifyShipment, type ShipmentVerifier } from "../shipment";

const query = { carrier: "DHL", trackingNumber: "12345 67890", shipToCountry: "GB" };

describe("verifyShipment", () => {
  it("allows a confirmed shipment and says the check was simulated", async () => {
    const decision = await verifyShipment(createSimulatedVerifier(), query);
    expect(decision.verdict).toBe("ALLOW");
    if (decision.verdict === "ALLOW") expect(decision.value.source).toBe("simulated");
  });

  it("rejects a bad format without calling the carrier", async () => {
    const verify = vi.fn();
    const decision = await verifyShipment({ verify }, { ...query, trackingNumber: "1111111111" });
    expect(decision.rule).toBe("TRACKING_INVALID");
    expect(verify).not.toHaveBeenCalled();
  });

  it("sends the carrier the normalized number", async () => {
    const verify = vi.fn<ShipmentVerifier["verify"]>(async () => ({
      status: "confirmed",
      source: "carrier",
      destinationCountry: null,
    }));
    const decision = await verifyShipment({ verify }, query);
    expect(verify.mock.calls[0]?.[0].trackingNumber).toBe("1234567890");
    expect(decision.verdict).toBe("ALLOW");
  });

  it.each([
    ["an unknown shipment", createSimulatedVerifier({ notFound: ["1234567890"] }), "SHIPMENT_NOT_FOUND"],
    ["the wrong country", createSimulatedVerifier({ destinations: { "1234567890": "FR" } }), "DESTINATION_MISMATCH"],
    ["a carrier outage", createSimulatedVerifier({ unavailable: true }), "SHIPMENT_CHECK_UNAVAILABLE"],
    [
      "a crashed check",
      { verify: () => Promise.reject(new Error("boom")) } satisfies ShipmentVerifier,
      "SHIPMENT_CHECK_UNAVAILABLE",
    ],
  ])("sends %s to a person", async (_name, verifier, rule) => {
    const decision = await verifyShipment(verifier, query);
    expect(decision.verdict).toBe("ESCALATE");
    expect(decision.rule).toBe(rule);
  });

  it("stops waiting for a stuck carrier and signals it", async () => {
    let signal: AbortSignal | undefined;
    const stuck: ShipmentVerifier = {
      verify(request) {
        signal = request.signal;
        return new Promise(() => undefined);
      },
    };
    const decision = await verifyShipment(stuck, query, 5);
    expect(decision.rule).toBe("SHIPMENT_CHECK_UNAVAILABLE");
    expect(signal?.aborted).toBe(true);
  });
});
