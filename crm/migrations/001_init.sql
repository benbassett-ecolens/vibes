-- Ecolens CRM: initial schema.
-- Every table carries created_at / updated_at; every mutation is also written to
-- audit_log (see server/audit.ts) and every stage move to deal_stage_history.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  picture_url   text,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pipelines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id       uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name              text NOT NULL,
  position          integer NOT NULL DEFAULT 0,
  probability       integer NOT NULL DEFAULT 50 CHECK (probability BETWEEN 0 AND 100),
  kind              text NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  -- Salesforce-style forecast category.
  forecast_category text NOT NULL DEFAULT 'pipeline'
                    CHECK (forecast_category IN ('pipeline', 'best_case', 'commit', 'closed', 'omitted')),
  -- Pipedrive-style rotting: deals idle in this stage longer than this go red. NULL = off.
  rot_after_days    integer CHECK (rot_after_days IS NULL OR rot_after_days > 0),
  color             text NOT NULL DEFAULT '#2a78d6',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stages_pipeline_idx ON stages(pipeline_id, position);

CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  domain      text,
  website     text,
  industry    text,
  phone       text,
  address     text,
  notes       text,
  owner_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX companies_name_idx ON companies(lower(name));
CREATE INDEX companies_owner_idx ON companies(owner_id);

CREATE TABLE contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name  text NOT NULL,
  last_name   text NOT NULL DEFAULT '',
  email       text,
  phone       text,
  title       text,
  notes       text,
  company_id  uuid REFERENCES companies(id) ON DELETE SET NULL,
  owner_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX contacts_name_idx ON contacts(lower(last_name), lower(first_name));
CREATE INDEX contacts_email_idx ON contacts(lower(email));
CREATE INDEX contacts_company_idx ON contacts(company_id);

CREATE TABLE deals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  pipeline_id         uuid NOT NULL REFERENCES pipelines(id),
  stage_id            uuid NOT NULL REFERENCES stages(id),
  amount              numeric(14, 2) NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'USD',
  company_id          uuid REFERENCES companies(id) ON DELETE SET NULL,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  expected_close_date date,
  -- Set when the deal enters a won/lost stage; cleared if reopened.
  closed_at           timestamptz,
  lost_reason         text,
  description         text,
  -- Ordering within a kanban column.
  position            double precision NOT NULL DEFAULT 0,
  -- When the deal entered its current stage (feeds time-in-stage + rotting).
  stage_entered_at    timestamptz NOT NULL DEFAULT now(),
  -- Last time any activity was logged or completed against this deal (feeds rotting).
  last_activity_at    timestamptz,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz
);
CREATE INDEX deals_pipeline_stage_idx ON deals(pipeline_id, stage_id, position);
CREATE INDEX deals_owner_idx ON deals(owner_id);
CREATE INDEX deals_company_idx ON deals(company_id);
CREATE INDEX deals_closed_idx ON deals(closed_at);

CREATE TABLE deal_stage_history (
  id            bigserial PRIMARY KEY,
  deal_id       uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES stages(id) ON DELETE SET NULL,
  to_stage_id   uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  changed_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  entered_at    timestamptz NOT NULL DEFAULT now(),
  -- Filled in when the deal leaves to_stage_id. NULL = still there.
  exited_at     timestamptz
);
CREATE INDEX deal_stage_history_deal_idx ON deal_stage_history(deal_id, entered_at);
CREATE INDEX deal_stage_history_stage_idx ON deal_stage_history(to_stage_id);

CREATE TABLE activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL CHECK (type IN ('note', 'call', 'email', 'meeting', 'task')),
  subject      text NOT NULL,
  body         text,
  deal_id      uuid REFERENCES deals(id) ON DELETE CASCADE,
  contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company_id   uuid REFERENCES companies(id) ON DELETE SET NULL,
  -- Who is responsible (for tasks: the assignee).
  owner_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  -- For tasks/meetings: when it is due / scheduled. For logged calls/emails: when it happened.
  due_at       timestamptz,
  completed_at timestamptz,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_deal_idx ON activities(deal_id, created_at DESC);
CREATE INDEX activities_contact_idx ON activities(contact_id);
CREATE INDEX activities_company_idx ON activities(company_id);
CREATE INDEX activities_owner_due_idx ON activities(owner_id, due_at) WHERE completed_at IS NULL;

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  action      text NOT NULL,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  -- { field: { from, to } } for updates; full snapshot for create/delete.
  changes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_created_idx ON audit_log(created_at DESC);

CREATE TABLE lost_reasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL UNIQUE,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Keep updated_at honest without relying on application code.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','pipelines','stages','companies','contacts','deals','activities']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- Default pipeline.
INSERT INTO pipelines (id, name, is_default, position)
VALUES ('00000000-0000-0000-0000-000000000001', 'Sales', true, 0);

INSERT INTO stages (pipeline_id, name, position, probability, kind, forecast_category, rot_after_days, color) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Lead',          0, 10,  'open', 'pipeline',  14, '#6250d6'),
  ('00000000-0000-0000-0000-000000000001', 'Qualified',     1, 25,  'open', 'pipeline',  14, '#2a78d6'),
  ('00000000-0000-0000-0000-000000000001', 'Proposal',      2, 50,  'open', 'best_case', 21, '#1baf7a'),
  ('00000000-0000-0000-0000-000000000001', 'Negotiation',   3, 75,  'open', 'commit',    21, '#eda100'),
  ('00000000-0000-0000-0000-000000000001', 'Closed Won',    4, 100, 'won',  'closed',    NULL, '#008300'),
  ('00000000-0000-0000-0000-000000000001', 'Closed Lost',   5, 0,   'lost', 'omitted',   NULL, '#e34948');

INSERT INTO lost_reasons (label, position) VALUES
  ('Price', 0), ('Went with competitor', 1), ('No budget', 2), ('No decision / went dark', 3),
  ('Timing', 4), ('Not a fit', 5), ('Other', 6);
