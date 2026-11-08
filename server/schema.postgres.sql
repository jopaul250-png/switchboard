-- Switchboard schema (PostgreSQL dialect, idempotent)
-- Generated from schema.sql with dialect changes:
--   * AUTOINCREMENT -> GENERATED ALWAYS AS IDENTITY
--   * datetime('now') -> generated always as (now())
--   * INTEGER/REAL preserved
--   * SQLite-specific SQL removed (none remain)

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (now()::text)
);

CREATE TABLE IF NOT EXISTS client_workspaces (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_type      TEXT NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free','premium')),
  contract_hours REAL NOT NULL DEFAULT 40,
  hours_used     REAL NOT NULL DEFAULT 0,   -- legacy display cache (see scopeSummary; derived)
  hours_manual   REAL NOT NULL DEFAULT 0,   -- P2: manual scope adjustments recorded separately
  created_at     TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_ws_owner ON client_workspaces(owner_id);

CREATE TABLE IF NOT EXISTS sop_documents (
  id           SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'general',
  created_at   TEXT NOT NULL DEFAULT (now()::text),
  updated_at   TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_sop_ws ON sop_documents(workspace_id);

CREATE TABLE IF NOT EXISTS secure_credentials (
  id           SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  username     TEXT,
  enc_payload  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_cred_ws ON secure_credentials(workspace_id);

CREATE TABLE IF NOT EXISTS task_lists (
  id              SERIAL PRIMARY KEY,
  workspace_id    INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  estimated_hours REAL NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_task_ws ON task_lists(workspace_id);

CREATE TABLE IF NOT EXISTS pulse_feeds (
  id           SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('Slack','Email','WhatsApp')),
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  updated_at   TEXT NOT NULL DEFAULT (now()::text),
  UNIQUE (workspace_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_pulse_ws ON pulse_feeds(workspace_id);

CREATE TABLE IF NOT EXISTS time_logs (
  id               SERIAL PRIMARY KEY,
  workspace_id     INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  task_description TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  started_at       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (now()::text)
);
CREATE INDEX IF NOT EXISTS idx_timelog_ws ON time_logs(workspace_id);
