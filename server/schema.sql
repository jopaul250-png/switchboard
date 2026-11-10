-- Switchboard schema (idempotent)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_workspaces (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_type      TEXT NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free','premium')),
  contract_hours REAL NOT NULL DEFAULT 40,
  hours_used     REAL NOT NULL DEFAULT 0,   -- legacy display cache (see scopeSummary; derived)
  hours_manual   REAL NOT NULL DEFAULT 0,   -- P2: manual scope adjustments recorded separately
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ws_owner ON client_workspaces(owner_id);

CREATE TABLE IF NOT EXISTS sop_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'general',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sop_ws ON sop_documents(workspace_id);

CREATE TABLE IF NOT EXISTS secure_credentials (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  username     TEXT,
  enc_payload  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cred_ws ON secure_credentials(workspace_id);

-- Phase 1.2: audit trail for credential reveals. Stores WHO attempted WHAT
-- against WHICH credential and WHEN — never the secret, never the token.
CREATE TABLE IF NOT EXISTS credential_access_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  credential_id INTEGER NOT NULL REFERENCES secure_credentials(id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN ('reveal','reveal_denied')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credlog_cred ON credential_access_log(credential_id);
CREATE INDEX IF NOT EXISTS idx_credlog_user ON credential_access_log(user_id);

CREATE TABLE IF NOT EXISTS task_lists (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id    INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  assigned_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  estimated_hours REAL NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_ws ON task_lists(workspace_id);

CREATE TABLE IF NOT EXISTS pulse_feeds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('Slack','Email','WhatsApp')),
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_pulse_ws ON pulse_feeds(workspace_id);

CREATE TABLE IF NOT EXISTS time_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id     INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  task_description TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  started_at       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_timelog_ws ON time_logs(workspace_id);
