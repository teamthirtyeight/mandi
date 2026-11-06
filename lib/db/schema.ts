// Seven tables cover the whole flow. All prices are integer minor units
// (pence/paise) so guardrail comparisons never hit rounding bugs.
import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  jsonb,
  uuid,
  date,
  boolean,
} from "drizzle-orm/pg-core";

export const negotiationState = pgEnum("negotiation_state", [
  "OPEN",
  "OFFERED",
  "COUNTERED",
  "AGREED",
  "AWAITING_BUYER_APPROVAL",
  "ORDERED",
  "WALKED_AWAY",
  "EXPIRED",
  "BLOCKED_BY_GUARDRAIL",
]);

export const orderStatus = pgEnum("order_status", [
  "CREATED",
  "APPROVED",
  "AUTHORIZED",
  "SHIPPED",
  "CAPTURED",
  "REFUNDED",
  "VOIDED",
]);

export const turnActor = pgEnum("turn_actor", ["buyer", "seller", "engine"]);
export const eventDirection = pgEnum("event_direction", ["call", "webhook"]);

export const sellers = pgTable("sellers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  country: text("country").notNull(),
  story: text("story").notNull(),
  // Payee for orders: the seller's PayPal sandbox business account.
  paypalMerchantEmail: text("paypal_merchant_email").notNull(),
  language: text("language").notNull().default("en"),
  // Shipping promise used by the deadline guardrail.
  shipByDays: integer("ship_by_days").notNull().default(3),
  transitDays: integer("transit_days").notNull().default(7),
  // Partial refunds above this need the seller's tap.
  refundCapMinor: integer("refund_cap_minor").notNull().default(1000),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const listings = pgTable("listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerId: uuid("seller_id")
    .notNull()
    .references(() => sellers.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  materials: text("materials").notNull(),
  images: jsonb("images").$type<string[]>().notNull().default([]),
  listPriceMinor: integer("list_price_minor").notNull(),
  // Never sent to any buyer-side prompt.
  floorPriceMinor: integer("floor_price_minor").notNull(),
  // Agent-proposed refunds up to this need no seller tap. Falls back to the seller's cap.
  refundCapMinor: integer("refund_cap_minor"),
  currency: text("currency").notNull().default("GBP"),
  stock: integer("stock").notNull().default(1),
  paypalProductId: text("paypal_product_id"),
  compsJson: jsonb("comps_json"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const mandates = pgTable("mandates", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerName: text("buyer_name").notNull(),
  requestText: text("request_text").notNull(),
  maxPriceMinor: integer("max_price_minor").notNull(),
  currency: text("currency").notNull().default("GBP"),
  deadline: date("deadline").notNull(),
  shipToCountry: text("ship_to_country").notNull(),
  approvalRule: text("approval_rule").notNull().default("human_approves_final_deal"),
  // Keywords the buyer agent searches listings with.
  query: text("query").notNull().default(""),
  // Demo switch: the buyer sends a scripted prompt-injection message.
  hostile: boolean("hostile").notNull().default(false),
  // Demo switch: the seller agent is scripted to fall for the attack, so the
  // engine's blocks and the leak filter show on camera.
  compromised: boolean("compromised").notNull().default(false),
  status: text("status").notNull().default("draft"),
  recommendedNegotiationId: uuid("recommended_negotiation_id"),
  recommendation: jsonb("recommendation"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const negotiations = pgTable("negotiations", {
  id: uuid("id").primaryKey().defaultRandom(),
  mandateId: uuid("mandate_id")
    .notNull()
    .references(() => mandates.id),
  listingId: uuid("listing_id")
    .notNull()
    .references(() => listings.id),
  state: negotiationState("state").notNull().default("OPEN"),
  sellerOfferMinor: integer("seller_offer_minor"),
  buyerOfferMinor: integer("buyer_offer_minor"),
  rounds: integer("rounds").notNull().default(0),
  agreedPriceMinor: integer("agreed_price_minor"),
  // Bundle add-on accepted after agreement: a second item from the same seller.
  addonListingId: uuid("addon_listing_id").references(() => listings.id),
  addonPriceMinor: integer("addon_price_minor"),
  outcomeReason: text("outcome_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const negotiationTurns = pgTable("negotiation_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  negotiationId: uuid("negotiation_id")
    .notNull()
    .references(() => negotiations.id),
  actor: turnActor("actor").notNull(),
  message: text("message").notNull(),
  proposedPriceMinor: integer("proposed_price_minor"),
  finalPriceMinor: integer("final_price_minor"),
  guardrailResult: text("guardrail_result").notNull(),
  injectionDetected: boolean("injection_detected").notNull().default(false),
  // The leak filter removed the sender's private limit from this message.
  limitRedacted: boolean("limit_redacted").notNull().default(false),
  // "agent" = model output, "fallback" = rule-based turn after invalid output.
  source: text("source").notNull().default("agent"),
  round: integer("round").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  negotiationId: uuid("negotiation_id").references(() => negotiations.id),
  paypalOrderId: text("paypal_order_id").unique(),
  authorizationId: text("authorization_id"),
  captureId: text("capture_id"),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("GBP"),
  refundedMinor: integer("refunded_minor").notNull().default(0),
  // Buyer's problem report and the seller agent's refund proposal.
  problemNote: text("problem_note"),
  // Buyer's photo (data URL), kept for the dispute evidence pack.
  problemPhoto: text("problem_photo"),
  agentRefundMessage: text("agent_refund_message"),
  // Set when the agent's proposal is above the seller's cap and needs their tap.
  pendingRefundMinor: integer("pending_refund_minor"),
  status: orderStatus("status").notNull().default("CREATED"),
  trackingNumber: text("tracking_number"),
  carrier: text("carrier"),
  authorizedAt: timestamp("authorized_at"),
  capturedAt: timestamp("captured_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const paypalEvents = pgTable("paypal_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").references(() => orders.id),
  direction: eventDirection("direction").notNull(),
  method: text("method"),
  endpoint: text("endpoint").notNull(),
  httpStatus: integer("http_status"),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
