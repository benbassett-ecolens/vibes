-- First-year deal value, deal type, contract length, renewals.

ALTER TABLE deals
  ADD COLUMN deal_type          text NOT NULL DEFAULT 'new_business' CHECK (deal_type IN ('new_business', 'renewal', 'upsell')),
  ADD COLUMN contract_months    integer CHECK (contract_months IS NULL OR contract_months > 0),
  ADD COLUMN renewal_of_deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  ADD COLUMN renewal_created_at timestamptz;
CREATE INDEX deals_renewal_of_idx ON deals(renewal_of_deal_id);
CREATE INDEX deals_expected_close_idx ON deals(expected_close_date);

-- "Core ERP Closed Won %" is entered as a dollar value on each deal, not a percentage.
UPDATE products SET pricing_type = 'one_time', description = 'Enter the estimated first-year dollar value on each deal'
WHERE name = 'Core ERP Closed Won %';
UPDATE products SET description = 'Enter the dollar value on each deal' WHERE name = 'Core ERP SQL';
UPDATE products SET description = 'Monthly amount; first-year value = monthly x 12' WHERE pricing_type = 'monthly';
