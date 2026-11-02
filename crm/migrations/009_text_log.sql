-- Text messages logged from Slack DMs ("share a text to the CRM bot, tap the deal").
ALTER TABLE activities DROP CONSTRAINT activities_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_type_check CHECK (type IN ('note', 'call', 'email', 'meeting', 'task', 'text'));
ALTER TABLE activities DROP CONSTRAINT activities_source_check;
ALTER TABLE activities ADD CONSTRAINT activities_source_check CHECK (source IN ('manual', 'gmail', 'gcal', 'slack'));

-- A DM the bot received and has not yet attached to a deal (or that was logged / dismissed).
CREATE TABLE slack_inbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      text UNIQUE,                       -- Slack event id, for retry de-duplication
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slack_user_id text NOT NULL,
  channel       text NOT NULL,                     -- the DM channel
  ts            text NOT NULL,                     -- the rep's message
  card_ts       text,                              -- the bot's reply card (buttons / confirmation)
  text          text NOT NULL DEFAULT '',
  files         jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{id, name, mimetype, url_private, size}]
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'logged', 'dismissed')),
  activity_id   uuid REFERENCES activities(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slack_inbox_pending_idx ON slack_inbox(user_id, created_at DESC) WHERE status = 'pending';
CREATE TRIGGER slack_inbox_updated BEFORE UPDATE ON slack_inbox FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Small binary attachments (screenshots shared from a phone). Kept in Postgres: a few hundred KB each.
CREATE TABLE attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  filename    text NOT NULL,
  mimetype    text NOT NULL,
  size        integer NOT NULL,
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_activity_idx ON attachments(activity_id);
