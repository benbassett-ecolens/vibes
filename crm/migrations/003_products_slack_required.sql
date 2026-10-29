-- Products / line items, deal lead source, Slack task links.

CREATE TABLE products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  sku          text,
  -- one_time: qty x price. monthly: qty x price x term_months. percent: basis_amount x price / 100.
  pricing_type text NOT NULL DEFAULT 'one_time' CHECK (pricing_type IN ('one_time', 'monthly', 'percent')),
  unit_price   numeric(14, 2) NOT NULL DEFAULT 0,
  description  text,
  is_active    boolean NOT NULL DEFAULT true,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE deal_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES products(id),
  pricing_type  text NOT NULL CHECK (pricing_type IN ('one_time', 'monthly', 'percent')),
  quantity      numeric(12, 2) NOT NULL DEFAULT 1,
  unit_price    numeric(14, 2) NOT NULL DEFAULT 0,
  term_months   integer NOT NULL DEFAULT 12,
  -- For percent pricing: the amount the percentage applies to.
  basis_amount  numeric(14, 2) NOT NULL DEFAULT 0,
  notes         text,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_products_deal_idx ON deal_products(deal_id, position);
CREATE TRIGGER deal_products_set_updated_at BEFORE UPDATE ON deal_products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO products (name, pricing_type, unit_price, position, description) VALUES
  ('Core ERP Monthly Retainer', 'monthly',  0, 0, 'Recurring retainer; amount = price x months'),
  ('Core ERP SQL',              'one_time', 0, 1, 'One-time'),
  ('Core ERP Closed Won %',     'percent',  0, 2, 'Percentage of the basis amount'),
  ('EcoNet subscription fee',   'monthly',  0, 3, 'Recurring subscription; amount = price x months'),
  ('AI build fee',              'one_time', 0, 4, 'One-time build'),
  ('AI monthly',                'monthly',  0, 5, 'Recurring; amount = price x months');

ALTER TABLE deals
  ADD COLUMN lead_source text,
  -- True when amount is derived from line items (recomputed on every line-item change).
  ADD COLUMN amount_from_products boolean NOT NULL DEFAULT false;

-- Slack two-way task sync: where the task card lives.
ALTER TABLE users ADD COLUMN slack_user_id text;
ALTER TABLE activities
  ADD COLUMN slack_channel text,
  ADD COLUMN slack_ts text;
CREATE INDEX activities_slack_idx ON activities(slack_channel, slack_ts) WHERE slack_ts IS NOT NULL;
