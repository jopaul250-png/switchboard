# PLAN.md — Switchboard
### Unified Client Hub for Virtual Assistants

> **Status:** BUILD MODE — approved. Executing milestones below.
> **Goal:** Solve "context-switching fatigue" for solo VAs managing multiple clients by giving each client its own isolated workspace (SOPs, credentials, tasks) behind a single login with instant workspace switching.

---

## 1. Feature Set (v1 — high-value scope, replaces basic defaults)

### 1.1 Multi-Tenant Client Switcher — `SidebarHero` component
- Persistent left sidebar with a vertical list of the VA's client workspaces.
- Each client entry has a **custom visual anchor** — a deterministic colored status dot (hashed from the workspace) for fast scanning.
- **Active notification badges** next to each client name, aggregated live from the `pulse_feeds` table (total unread across Slack / Email / WhatsApp queues).
- **Real-time free-tier tracker** pinned at the bottom of the sidebar: "Workspaces Used: X/2 (Free)", plus a prominent **Upgrade** call-to-action button that flips the workspace to premium and immediately lifts the cap.

### 1.2 Centralized SOP & Brand Vault
- Searchable, **card-based repository** inside each workspace for brand guidelines, color hex codes, typography, and formatting rules (`category` field drives filtering).
- **Split-pane editor:** markdown textarea on the left, **live HTML preview** on the right (rendered on every keystroke), with save-on-exit.
- Card search matches title, category, and content.

### 1.3 Encrypted Credentials Locker (Secure Vault)
- Secure manager for client usernames, logins, and API tokens, workspace-scoped.
- All secret values render as masked characters (`••••••••`) in every list.
- Explicit **"Reveal"** link → calls a dedicated decryption route (`POST …/credentials/:id/reveal`) → plaintext shown in a **timed window (10s countdown)** → auto-remasks without any page refresh.
- One-click copy-to-clipboard from the revealed value.

### 1.4 Scope Guardrail & Task Board
- 3-column Trello-style board: **Todo / In Progress / Done**; tasks move left/right via controls (PATCH).
- **Scope Meter** progress bar atop the workspace dashboard: `hours_used` vs `contract_hours` (contract hours editable in Settings; manual adjustments recorded separately via `hours_manual`).
- **Accounting model (actuals-only):** `hours_used = tracked_hours (sum of time_logs) + manual_hours (hours_manual)`. Task `estimated_hours` are **forecasting only** — marking a task Done never moves the meter, so stopwatch actuals and estimates can never double-count. Deleting a task leaves the meter untouched.
- Color escalation: < 75% green, 75–100% amber, > 100% red — instantly signals near/over-limit on billable allocation.

### 1.5 Webhook "Pulse" Widget
- Summary card inside the active workspace aggregating **simulated message counters** from distinct notification queues: **Slack, Email, WhatsApp** (rows in `pulse_feeds`).
- Per-channel unread chips + total badge; "Simulate incoming" seeds a randomized notification to demo the flow.
- A single **"Clear Feed"** action button instantly resets all unread counts in the active workspace to zero (sidebar badges update reactively).

### 1.6 Trust-based Time Tracking Engine
- A new `time_logs` table records raw tracked sessions per workspace (`task_description`, `duration_seconds`, `started_at`).
- **Floating stopwatch widget** lives inside the workspace main layout panel: short task-description input, a ticking `HH:MM:SS` duration clock, and a Start/Pause toggle.
- **Live sync on Stop:** clicking "Stop" computes exact decimal hours (`duration_seconds / 3600`), POSTs the raw record to `time_logs`, and triggers an active increment onto `client_workspaces.hours_used` — the dashboard **Scope Meter updates immediately** (no full page refresh).
- Sessions are attributed to the workspace they *started* in — switching clients mid-session pauses the clock and preserves correct billing attribution.
- Manual "delete log" entry subtracts its hours again (keeps the meter honest).

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        BROWSER (SPA)                        │
│   Vite + React 18 + Tailwind CSS                            │
│   React Router │ AuthContext + WorkspaceContext             │
│   SidebarHero switcher │ Dashboard/SOPs/Vault/Tasks views   │
└──────────────────────────┬───────────────────────────────────┘
                           │  fetch() — JSON over HTTP (/api proxy)
                           │  Authorization: Bearer <JWT>
┌──────────────────────────▼───────────────────────────────────┐
│                   EXPRESS API  (Node.js, :3001)             │
│   routes/  middleware/ (authRequired → workspaceScope)       │
│   lib/ (jwt, bcrypt, AES-256-GCM) — handlers inlined in routes│
└──────────────────────────┬───────────────────────────────────┘
                           │  better-sqlite3 (sync, WAL)
┌──────────────────────────▼───────────────────────────────────┐
│                  SQLite  (server/data/switchboard.db)       │
└──────────────────────────────────────────────────────────────┘
```

**Key decisions**

| Decision | Choice | Rationale |
|---|---|---|
| SQLite driver | `better-sqlite3` | Sync + fast for local dev; WAL mode. |
| Auth | JWT (stateless, 7-day) | No session store needed in v1. |
| Multi-tenancy | Shared DB + `workspace_id` FK | Trello-style: one User → many Workspaces; every tenant query filtered by ownership middleware. |
| Credential security | AES-256-GCM per record, key from `ENCRYPTION_KEY` | DB leak ≠ plaintext leak; decryption only via `/reveal`. |
| Plan gating | Server-side `planLimits` middleware → `402` | Not spoofable client-side. |
| Dev workflow | `concurrently` runs :3001 + :5173 | One `npm run dev`. |

---

## 3. File Structure (target state)

```
VA Tool/
├── PLAN.md
├── README.md
├── package.json                  ← root: concurrently dev script
├── .gitignore                    ← node_modules, .env, *.db
│
├── server/
│   ├── package.json  .env        ← PORT, JWT_SECRET, ENCRYPTION_KEY
│   ├── index.js                  ← express json/cors, route mounting
│   ├── db.js                     ← better-sqlite3 + WAL + migrate
│   ├── schema.sql                ← all 6 tables (idempotent)
│   ├── lib/
│   │   ├── crypto.js             ← AES-256-GCM encrypt/decrypt
│   │   ├── passwords.js          ← bcrypt hash/compare
│   │   └── jwt.js                ← sign/verify
│   ├── middleware/
│   │   ├── authRequired.js       ← Bearer JWT → req.user
│   │   ├── workspaceScope.js     ← :workspaceId ownership check → req.workspace
│   │   └── planLimits.js         ← free tier ⇒ max 2 workspaces
│   ├── routes/
│   │   ├── auth.routes.js        ← register / login / me
│   │   ├── workspace.routes.js   ← list / create / detail / PATCH / DELETE
│   │   ├── sop.routes.js         ← SOP CRUD
│   │   ├── credential.routes.js  ← vault CRUD + /reveal
│   │   ├── task.routes.js        ← board CRUD + scopeSummary (derived meter)
│   │   ├── pulse.routes.js       ← queues get / simulate / clear
│   │   └── timeLog.routes.js     ← time tracking (POST logs + scope increment)
│   └── data/switchboard.db       ← gitignored
│
└── client/
    ├── package.json  vite.config.js  tailwind.config.js  postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx  App.jsx  index.css
        ├── api/client.js         ← fetch wrapper + JWT + 401 handling
        ├── context/
        │   ├── AuthContext.jsx
        │   └── WorkspaceContext.jsx   ← workspaces[], active, pulse refresh
        ├── layouts/AppShell.jsx
        ├── components/
        │   ├── SidebarHero.jsx       ← switcher + badges + plan meter (1.1)
        │   ├── ScopeMeter.jsx        ← hours_used bar (1.4)
        │   ├── PulseWidget.jsx       ← queues + Clear Feed (1.5)
        │   ├── StopwatchWidget.jsx   ← floating time tracker (1.6)
        │   ├── CreateWorkspaceModal.jsx
        │   └── ui.jsx                ← Button/Badge/Modal/EmptyState
        └── pages/
            ├── Login.jsx
            ├── Dashboard.jsx         ← Scope Meter + Pulse + stats
            ├── SopsPage.jsx          ← card grid + split-pane editor (1.2)
            ├── CredentialsPage.jsx   ← vault + timed reveal (1.3)
            ├── TasksPage.jsx         ← 3-col board (1.4)
            └── SettingsPage.jsx      ← rename/plan/contract hours/delete
```

---

## 4. Database Schema (7 tables)

```sql
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
  contract_hours REAL NOT NULL DEFAULT 40,   -- Scope Meter denominator
  hours_used     REAL NOT NULL DEFAULT 0,   -- derived display value (scopeSummary); see 1.4
  hours_manual   REAL NOT NULL DEFAULT 0,   -- manual adjustments, recorded separately
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ws_owner ON client_workspaces(owner_id);

CREATE TABLE IF NOT EXISTS sop_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',    -- markdown (brand guidelines, hex codes…)
  category     TEXT NOT NULL DEFAULT 'general',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS secure_credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  account_name  TEXT NOT NULL,
  username      TEXT,                        -- nullable (API tokens may not have one)
  enc_payload   TEXT NOT NULL,               -- AES-256-GCM base64(iv||tag||cipher)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_lists (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id   INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  estimated_hours REAL NOT NULL DEFAULT 1,   -- forecasting only; never books meter hours
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pulse_feeds (          -- Webhook "Pulse" queues
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('Slack','Email','WhatsApp')),
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (workspace_id, channel)
);

CREATE TABLE IF NOT EXISTS time_logs (            -- trust-based time tracking
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id     INTEGER NOT NULL REFERENCES client_workspaces(id) ON DELETE CASCADE,
  task_description TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  started_at       TEXT NOT NULL,                 -- session start (ISO)
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_timelog_ws ON time_logs(workspace_id);
```

---

## 5. API Surface (REST, prefix `/api`)

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` · `/auth/login` | → `{ token, user }` |
| GET | `/auth/me` | current user |
| GET | `/workspaces` | all owned workspaces **+ `pulse_unread` (sidebar badges)** |
| POST | `/workspaces` | **planLimits**: free tier hard cap **2** → `402 { code:'WORKSPACE_LIMIT' }` |
| GET/PATCH/DELETE | `/workspaces/:id` | PATCH: rename, `plan_type`, `contract_hours`, `hours_manual` (returns fresh derived `{ workspace, scope }`) |
| GET | `/workspaces/:id/tasks` `?status=` | list |
| POST/PATCH/DELETE | `/workspaces/:id/tasks[/:taskId]` | status transitions **never** mutate the meter (estimates ≠ actuals); returns `{ task, scope }` for instant UI sync |
| GET/POST | `/workspaces/:id/sops` | card list (supports search client-side) |
| GET/PUT/DELETE | `/workspaces/:id/sops/:sopId` | detail / update / delete |
| POST | `/workspaces/:id/credentials` | creates encrypted entry; secrets never echo back |
| GET/DELETE | `/workspaces/:id/credentials[/:credId]` | **lists return masked `••••••••` only** |
| POST | `/workspaces/:id/credentials/:credId/reveal` | **dedicated decryption route** → `{ plaintext }` |
| GET | `/workspaces/:id/pulse` | `{ feeds:[{channel,unread_count}], total_unread }` |
| POST | `/workspaces/:id/pulse/simulate` | adds randomized incoming messages (Slack/Email/WhatsApp) |
| POST | `/workspaces/:id/pulse/clear` | **resets every unread_count to 0** |
| GET | `/workspaces/:id/time-logs` | recent raw logs + `total_seconds` for the workspace |
| POST | `/workspaces/:id/time-logs` | **Stop** action: saves `{task_description, duration_seconds, started_at}`, adds `duration_seconds/3600` to `hours_used`; returns `{ log, scope }` for instant meter update |
| DELETE | `/workspaces/:id/time-logs/:logId` | mistake-fix: removes the log; its actual hours drop out of the derived meter (returns `{ scope }`) |

All `/workspaces/:id/*` requests pass `authRequired` → `workspaceScope` (403/404 if not owner). Workspaces aren't encoded in the JWT — switching is a pure UI state change backed by per-request scoping.

---

## 6. Implementation Milestones

1. **M1 Skeleton** — monorepo scripts, Express + SQLite + schema, Vite/Tailwind shell, green `/api/health`.
2. **M2 Auth & Workspaces** — users table, bcrypt, JWT, register/login/me, workspace CRUD + ownership middleware; Login page, AuthContext, protected AppShell with empty SidebarHero.
3. **M3 Plan Limits** — 2-workspace free cap via `planLimits` → structured 402; CreateWorkspaceModal + upgrade flow (`PATCH plan_type:'premium'`); sidebar tracker "X/2".
4. **M4 Feature APIs** — SOP CRUD; encrypted credentials (masquerading lists, `/reveal`); tasks CRUD (estimates forecast-only); pulse queues (get/simulate/clear). Tenant-isolation smoke tests.
5. **M5 Dashboard UI** — activate the full feature set: SidebarHero (dots, badges, tracker, Upgrade CTA), Dashboard (ScopeMeter + PulseWidget + stats), SOP vault split-pane editor, credentials locker with timed reveal, 3-col task board wired to the Scope Meter, Settings.
6. **M6 Time Tracking Engine** — `time_logs` table; floating StopwatchWidget (description input, ticking HH:MM:SS, Start/Pause/Stop); POST on Stop saves the raw log and actively increments `hours_used`; Scope Meter updates instantly via `{ log, scope }` responses; session attribution pinned to the workspace it started in; delete-log undo.

**Out of scope (v1):** real Stripe billing (plan switch is manual), team RBAC beyond `assigned_to`, attachments, Postgres.

---

## 7. Definition of Done
- [ ] `npm run dev` boots API + SPA together.
- [ ] Register → 2 free workspaces → 3rd blocked with upgrade modal → upgrade → clearance.
- [ ] Sidebar dots, live unread badges, "X/2" tracker all reactive (pulse/simulate/clear reflected without reload).
- [ ] SOP vault: search + split-pane markdown preview.
- [ ] Vault: masked everywhere; reveal decrypts once via dedicated route, auto-remasks after 10s.
- [ ] Task moved to Done → meter **unchanged** (estimates never book actuals) → Scope Meter escalates color as tracked hours cross 75%/100%.
- [ ] Stopwatch: Start → tick Stop → raw row in `time_logs`, derived meter grows by `duration_seconds/3600` without reload; deleting a log subtracts again.
