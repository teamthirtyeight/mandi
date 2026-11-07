-- The columns and constraints the guardrail operations rely on.
-- lib/db's Drizzle schema must include these, and may add its own columns.
-- The constraints are the last line of defence if application code has a bug.

CREATE TABLE sellers (
  id            text PRIMARY KEY,
  paypal_email  text NOT NULL
);

CREATE TABLE listings (
  id                text PRIMARY KEY,
  seller_id         text NOT NULL REFERENCES sellers (id),
  stock             integer NOT NULL CHECK (stock >= 0),
  -- NULL means an agent may never refund automatically.
  refund_cap_minor  integer CHECK (refund_cap_minor >= 0)
);

CREATE TABLE mandates (
  id               text PRIMARY KEY,
  max_price_minor  integer NOT NULL CHECK (max_price_minor > 0),
  currency         text NOT NULL
);

CREATE TABLE negotiations (
  id            text PRIMARY KEY,
  mandate_id    text NOT NULL REFERENCES mandates (id),
  listing_id    text NOT NULL REFERENCES listings (id),
  status        text NOT NULL,
  agreed_minor  integer,
  frozen_deal   jsonb
);

CREATE TABLE orders (
  id                    text PRIMARY KEY,
  -- One order per deal, whatever the application does.
  negotiation_id        text NOT NULL UNIQUE REFERENCES negotiations (id),
  listing_id            text NOT NULL REFERENCES listings (id),
  amount_minor          integer NOT NULL CHECK (amount_minor > 0),
  currency              text NOT NULL,
  ship_to_country       text NOT NULL,
  ship_by_at            timestamptz NOT NULL,
  status                text NOT NULL CHECK (status IN (
    'CREATED', 'APPROVED', 'AUTHORIZED', 'SHIPPED', 'CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED'
  )),
  paypal_order_id       text,
  authorization_id      text,
  capture_id            text,
  captured_minor        integer NOT NULL DEFAULT 0 CHECK (captured_minor >= 0),
  refunded_total_minor  integer NOT NULL DEFAULT 0 CHECK (refunded_total_minor >= 0),
  refund_count          integer NOT NULL DEFAULT 0,
  auto_refund_count     integer NOT NULL DEFAULT 0,
  carrier               text,
  tracking_number       text,
  tracking_entered_by   text,
  shipment_verified_by  text,
  capture_lease_until   timestamptz,
  -- Refunds can never exceed what was captured.
  CHECK (refunded_total_minor <= captured_minor)
);

-- One tracking number can't release money on two orders.
CREATE UNIQUE INDEX orders_tracking_number_unique
  ON orders (tracking_number)
  WHERE tracking_number IS NOT NULL;

CREATE TABLE refunds (
  request_id        text PRIMARY KEY,
  order_id          text NOT NULL REFERENCES orders (id),
  amount_minor      integer NOT NULL CHECK (amount_minor > 0),
  approved_by       text NOT NULL CHECK (approved_by IN ('agent', 'seller')),
  status            text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'RELEASED')),
  paypal_refund_id  text
);
