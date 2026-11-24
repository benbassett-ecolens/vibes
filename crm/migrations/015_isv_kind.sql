-- ISVs (independent software vendors) are a fourth kind of company record, like VARs and ERPs.
ALTER TABLE companies DROP CONSTRAINT companies_kind_check;
ALTER TABLE companies ADD CONSTRAINT companies_kind_check CHECK (kind IN ('company', 'var', 'erp', 'isv'));
ALTER TABLE company_news DROP CONSTRAINT company_news_scope_kind_check;
ALTER TABLE company_news ADD CONSTRAINT company_news_scope_kind_check CHECK (scope_kind IN ('company', 'var', 'erp', 'isv'));
-- Imported rows typed plain "ISV" (not "ISV, VAR") move over.
UPDATE companies SET kind = 'isv' WHERE kind = 'company' AND partner_type IS NOT NULL AND partner_type ~* '^\s*ISV\s*$';
