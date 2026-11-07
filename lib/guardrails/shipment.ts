/**
 * Asks a carrier whether a shipment exists before money is captured. The demo
 * uses the simulated verifier. A real tracking service can replace it without
 * changing the callers. Even a real lookup only shows that a parcel exists, not
 * that it holds the right item.
 */
import { allow, deny, escalate, type Decision } from "./core";
import { normalizeTracking } from "./money";

export type ShipmentEvidence =
  | { status: "confirmed"; source: VerifierSource; destinationCountry: string | null }
  | { status: "not_found"; source: VerifierSource }
  | { status: "unavailable"; source: VerifierSource };

/** "simulated" must be shown as such in the UI and never presented as a real scan. */
export type VerifierSource = "simulated" | "carrier";

export interface ShipmentQuery {
  carrier: string;
  trackingNumber: string;
  shipToCountry: string;
  signal?: AbortSignal;
}

export interface ShipmentVerifier {
  verify(query: ShipmentQuery): Promise<ShipmentEvidence>;
}

export type ConfirmedShipment = Extract<ShipmentEvidence, { status: "confirmed" }>;

export const DEFAULT_VERIFY_TIMEOUT_MS = 10_000;

/**
 * Fails safe: money is only released on a confirmed shipment. If the carrier
 * can't confirm one, or the check fails, a person reviews it.
 */
export async function verifyShipment(
  verifier: ShipmentVerifier,
  query: Omit<ShipmentQuery, "signal">,
  timeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
): Promise<Decision<ConfirmedShipment>> {
  const trackingNumber = normalizeTracking(query.carrier, query.trackingNumber);
  if (trackingNumber === null) {
    return deny("TRACKING_INVALID", "tracking number does not fit the carrier's format");
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  let evidence: ShipmentEvidence | null;
  try {
    const lookup = Promise.resolve().then(() =>
      verifier.verify({ ...query, trackingNumber, signal: controller.signal }),
    );
    lookup.catch(() => undefined); // A failure arriving after the time limit is ignored.
    evidence = await Promise.race([lookup, timeout]);
  } catch {
    evidence = null;
  } finally {
    clearTimeout(timer);
  }

  if (evidence === null || evidence.status === "unavailable") {
    return escalate("SHIPMENT_CHECK_UNAVAILABLE", "the shipment could not be checked, so a person must review it");
  }
  if (evidence.status === "not_found") {
    return escalate("SHIPMENT_NOT_FOUND", "the carrier has no record of this shipment yet");
  }
  if (evidence.destinationCountry !== null && evidence.destinationCountry !== query.shipToCountry) {
    return escalate("DESTINATION_MISMATCH", "the shipment is going to a different country than the order");
  }
  return allow("SHIPMENT_CONFIRMED", `shipment confirmed by the ${evidence.source} check`, evidence);
}

export interface SimulatedVerifierOptions {
  /** Normalized tracking numbers to report as unknown. */
  notFound?: readonly string[];
  /** Normalized tracking numbers mapped to the destination to report. */
  destinations?: Readonly<Record<string, string>>;
  /** Simulates a carrier outage. */
  unavailable?: boolean;
}

/**
 * For the demo and tests. It confirms any well-formed number unless told
 * otherwise, so it proves nothing about a real parcel.
 */
export const createSimulatedVerifier = (options: SimulatedVerifierOptions = {}): ShipmentVerifier => ({
  async verify({ trackingNumber, shipToCountry }) {
    if (options.unavailable) return { status: "unavailable", source: "simulated" };
    if (options.notFound?.includes(trackingNumber)) return { status: "not_found", source: "simulated" };
    return {
      status: "confirmed",
      source: "simulated",
      destinationCountry: options.destinations?.[trackingNumber] ?? shipToCountry,
    };
  },
});
