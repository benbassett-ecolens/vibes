-- Reporting lines and departments on contacts, for the organization chart on company/VAR pages.
ALTER TABLE contacts
  ADD COLUMN reports_to_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN department    text,
  ADD COLUMN influence     text CHECK (influence IS NULL OR influence IN ('decision_maker', 'champion', 'influencer', 'blocker', 'user'));
CREATE INDEX contacts_reports_to_idx ON contacts(reports_to_id);
