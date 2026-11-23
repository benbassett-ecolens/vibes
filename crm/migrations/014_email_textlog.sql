-- Text messages are now logged by emailing them to the log address (see README); the Slack
-- share-to-channel path is removed. Attachments (screenshots) stay in `attachments`.
DROP TABLE IF EXISTS slack_inbox;

CREATE TABLE log_inbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source       text NOT NULL DEFAULT 'email' CHECK (source IN ('email')),
  external_id  text NOT NULL UNIQUE,              -- RFC Message-ID
  gmail_id     text NOT NULL,                     -- for fetching attachments later
  subject      text,
  text         text NOT NULL DEFAULT '',
  files        jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{attachment_id, name, mimetype, size}]
  received_at  timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'logged', 'dismissed')),
  activity_id  uuid REFERENCES activities(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX log_inbox_pending_idx ON log_inbox(user_id, received_at DESC) WHERE status = 'pending';
CREATE TRIGGER log_inbox_updated BEFORE UPDATE ON log_inbox FOR EACH ROW EXECUTE FUNCTION set_updated_at();
