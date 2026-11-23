-- ERP publishers (Microsoft, Acumatica, NetSuite, Sage, SAP…) are a third kind of company record, like VARs.
ALTER TABLE companies DROP CONSTRAINT companies_kind_check;
ALTER TABLE companies ADD CONSTRAINT companies_kind_check CHECK (kind IN ('company', 'var', 'erp'));
-- Cross-record news questions ("what's new across our ERPs?") remember which kind they covered.
ALTER TABLE company_news ADD COLUMN scope_kind text NOT NULL DEFAULT 'var' CHECK (scope_kind IN ('company', 'var', 'erp'));
