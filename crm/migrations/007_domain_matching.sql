-- Domain-level matching for synced email/calendar items.
CREATE TABLE sync_ignored_domains (
  domain     text PRIMARY KEY,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX companies_domain_idx ON companies(lower(domain)) WHERE domain IS NOT NULL;
-- Common system/vendor senders nobody wants as contacts.
INSERT INTO sync_ignored_domains (domain) VALUES
  ('google.com'), ('calendar-notification.google.com'), ('docs.google.com'), ('accounts.google.com'),
  ('linkedin.com'), ('slack.com'), ('zoom.us'), ('notion.so'), ('github.com'), ('atlassian.net'), ('hubspot.com'),
  ('mail.hubspot.com'), ('salesforce.com'), ('docusign.net'), ('docusign.com'), ('intuit.com'), ('quickbooks.com'),
  ('amazon.com'), ('stripe.com'), ('calendly.com'), ('granola.ai'), ('anthropic.com'), ('openai.com')
ON CONFLICT DO NOTHING;
