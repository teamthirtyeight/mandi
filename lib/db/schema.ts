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
export const userRole = pgEnum("user_role", ["buyer", "seller"]);
export const eventDirection = pgEnum("event_direction", ["call", "webhook"]);

export const sellers = pgTable("sellers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  country: text("country").notNull(),
  story: text("story").notNull(),
  // "Meet the maker" on listing pages: where they work, their craft, a line in
  // their own words, and a photo of the craft with its credit (lib/db/seed.ts).
  region: text("region"),
  craft: text("craft"),
  quote: text("quote"),
  photoUrl: text("photo_url"),
  photoCredit: text("photo_credit"),
  photoSource: text("photo_source"),
  // Payee for orders: the seller's PayPal sandbox business account.
  paypalMerchantEmail: text("paypal_merchant_email").notNull(),
  language: text("language").notNull().default("en"), // lib/i18n/seller.ts SELLER_LANGUAGES
  // WhatsApp alerts (lib/whatsapp.ts): E.164 number and explicit opt-in.
  whatsappNumber: text("whatsapp_number"),
  whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
  // Shipping promise used by the deadline guardrail.
  shipByDays: integer("ship_by_days").notNull().default(3),
  transitDays: integer("transit_days").notNull().default(7),
  // Partial refunds above this need the seller's tap.
  refundCapMinor: integer("refund_cap_minor").notNull().default(1000),
  // Seller agent settings (the "My agent" page).
  agentStyle: text("agent_style").notNull().default("balanced"), // firm | balanced | flexible
  offerGiftWrap: boolean("offer_gift_wrap").notNull().default(true),
  offerBundles: boolean("offer_bundles").notNull().default(true),
  maxBundleDiscountPct: integer("max_bundle_discount_pct").notNull().default(15),
  agentNote: text("agent_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull(),
  name: text("name").notNull(),
  // Sellers: the seller profile this login manages.
  sellerId: uuid("seller_id").references(() => sellers.id),
  // Buyers: default ship-to country for new mandates.
  shipToCountry: text("ship_to_country").notNull().default("GB"),
  // Buyer agent settings (the "My agent" page).
  agentStyle: text("agent_style").notNull().default("balanced"), // patient | balanced | quick
  maxSellers: integer("max_sellers").notNull().default(3),
  acceptBundles: boolean("accept_bundles").notNull().default(true),
  priority: text("priority").notNull().default("balanced"), // price | balanced | delivery
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
  // Credit for a borrowed first photo (the demo's Wikimedia Commons photos);
  // null for a seller's own photos.
  imageCredit: text("image_credit"),
  imageSource: text("image_source"),
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
  buyerUserId: uuid("buyer_user_id").references(() => users.id),
  // Set when the buyer sent their agent after one specific listing.
  targetListingId: uuid("target_listing_id").references(() => listings.id),
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
  // PayPal refund ids already counted in refundedMinor, so a retried request
  // (PayPal returns the same refund) is never counted twice.
  refundIds: jsonb("refund_ids").$type<string[]>().notNull().default([]),
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
  // Who PayPal pays: the seller's own account, or null for the Mandi merchant.
  payeeEmail: text("payee_email"),
  // Stock was taken for this order's item(s); given back if the hold is voided.
  stockReserved: boolean("stock_reserved").notNull().default(false),
  // Where to ship: the address the buyer chose in the PayPal popup.
  shipping: jsonb("shipping").$type<{
    name: string | null;
    lines: string[];
    city: string | null;
    region: string | null;
    postalCode: string | null;
    countryCode: string | null;
  }>(),
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

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  link: text("link"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  // SHA-256 of the token; the token itself is only ever in the link.
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Every WhatsApp message Mandi sends (or would send, without Twilio keys), so
// sellers and judges can see exactly what went out.
export const whatsappMessages = pgTable("whatsapp_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sellerId: uuid("seller_id")
    .notNull()
    .references(() => sellers.id, { onDelete: "cascade" }),
  orderId: uuid("order_id"),
  to: text("to").notNull(),
  body: text("body").notNull(),
  mediaUrl: text("media_url"), // banner card attached to the message, if any
  status: text("status").notNull(), // sent | logged | failed
  providerId: text("provider_id"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
