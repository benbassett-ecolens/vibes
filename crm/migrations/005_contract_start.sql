-- Contract start date drives renewal timing: the renewal deal is created
-- RENEWAL_LEAD_DAYS (45) after the contract starts, with expected close = contract end.
ALTER TABLE deals ADD COLUMN contract_start_date date;
UPDATE deals SET contract_start_date = closed_at::date WHERE closed_at IS NOT NULL AND contract_months IS NOT NULL AND contract_start_date IS NULL;
CREATE INDEX deals_renewal_due_idx ON deals(contract_start_date) WHERE renewal_created_at IS NULL AND contract_months IS NOT NULL;
