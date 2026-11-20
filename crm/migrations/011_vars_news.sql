-- VARs (value-added resellers) are a separate kind of company record: own page, own list,
-- same contacts/timeline machinery. Backfilled from the imported partner type.
ALTER TABLE companies ADD COLUMN kind text NOT NULL DEFAULT 'company' CHECK (kind IN ('company', 'var'));
UPDATE companies SET kind = 'var' WHERE partner_type ILIKE '%VAR%';
CREATE INDEX companies_kind_idx ON companies(kind) WHERE archived_at IS NULL;

-- Natural-language news questions answered by Claude with web search. company_id NULL = asked across all VARs.
CREATE TABLE company_news (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies(id) ON DELETE CASCADE,
  question    text NOT NULL,
  answer      text NOT NULL,
  sources     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{url, title}]
  model       text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_news_company_idx ON company_news(company_id, created_at DESC);
