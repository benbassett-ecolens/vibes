-- Ecosystem (Microsoft, Acumatica, NetSuite, Sage, SAP-B1, …) and partner type (ISV/VAR/Other) as real company fields.
ALTER TABLE companies
  ADD COLUMN ecosystems   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN partner_type text;
CREATE INDEX companies_ecosystems_idx ON companies USING gin (ecosystems);

-- Backfill from the notes the importer wrote ("Ecosystem: Microsoft, Acumatica" / "Type: ISV").
UPDATE companies SET ecosystems = COALESCE((
  SELECT array_agg(DISTINCT trim(x)) FROM unnest(string_to_array(substring(notes from 'Ecosystem: ([^\n]+)'), ',')) AS x WHERE trim(x) <> ''
), '{}') WHERE notes ~ 'Ecosystem: ';
UPDATE companies SET partner_type = trim(substring(notes from 'Type: ([^\n]+)')) WHERE notes ~ 'Type: ' AND partner_type IS NULL;
