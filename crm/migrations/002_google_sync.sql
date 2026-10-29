-- Gmail + Google Calendar sync.

-- Per-user Google connection. Refresh tokens are encrypted at rest (server/google/crypto.ts).
CREATE TABLE google_connections (
  user_id                 uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_email            text NOT NULL,
  refresh_token_enc       text NOT NULL,
  scopes                  text[] NOT NULL DEFAULT '{}',
  -- How far back the first Gmail sync looks (days).
  gmail_sync_window_days  integer NOT NULL DEFAULT 30,
  gmail_sync_enabled      boolean NOT NULL DEFAULT true,
  calendar_sync_enabled   boolean NOT NULL DEFAULT true,
  -- Gmail: we only ask for messages after this point (set after each successful run).
  gmail_synced_through    timestamptz,
  gmail_last_synced_at    timestamptz,
  -- Calendar: incremental sync token from the Calendar API.
  calendar_sync_token     text,
  calendar_last_synced_at timestamptz,
  last_error              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER google_connections_set_updated_at BEFORE UPDATE ON google_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every sync run is recorded (timestamps on everything).
CREATE TABLE sync_runs (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('gmail', 'calendar')),
  trigger      text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'scheduled', 'connect')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  items_seen   integer NOT NULL DEFAULT 0,
  items_logged integer NOT NULL DEFAULT 0,
  items_updated integer NOT NULL DEFAULT 0,
  error        text
);
CREATE INDEX sync_runs_user_idx ON sync_runs(user_id, started_at DESC);

-- Activities can now come from a sync source.
ALTER TABLE activities
  ADD COLUMN source       text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'gmail', 'gcal')),
  ADD COLUMN external_id  text,
  ADD COLUMN external_url text,
  ADD COLUMN ends_at      timestamptz,
  ADD COLUMN meta         jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One activity per external item across the whole team (two reps on the same thread
-- or invite do not produce two activities).
CREATE UNIQUE INDEX activities_external_idx ON activities(source, external_id) WHERE external_id IS NOT NULL;

-- Items we saw but could not match to any contact. Kept so the UI can offer
-- "create contact from this sender" and so we never re-process them.
CREATE TABLE sync_unmatched (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source      text NOT NULL CHECK (source IN ('gmail', 'gcal')),
  external_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  subject     text,
  -- external (non-company-domain) addresses seen on the item
  addresses   jsonb NOT NULL DEFAULT '[]'::jsonb,
  external_url text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  UNIQUE (source, external_id)
);
CREATE INDEX sync_unmatched_user_idx ON sync_unmatched(user_id, occurred_at DESC) WHERE dismissed_at IS NULL;
