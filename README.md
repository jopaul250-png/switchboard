# Switchboard — Unified Client Hub for Virtual Assistants

A niche SaaS platform that eliminates **context-switching fatigue** for freelance VAs managing multiple clients. Each client gets an isolated workspace (SOPs, encrypted credentials, tasks, notification pulse) behind a single login with instant sidebar switching.

## Stack
- **Frontend:** Vite + React 18 + Tailwind CSS (SPA)
- **Backend:** Node.js + Express REST API (JWT auth)
- **Database:** SQLite via `better-sqlite3` (WAL)
- **Secrets:** AES-256-GCM encryption at rest, bcrypt password hashing

## Quick start
```bash
npm run install:all   # installs root + server + client deps (run once)
npm run dev           # starts API (:3001) + SPA (:5173) together
```

Then open **http://localhost:5173** — register an account and you're in.

## Feature map
| Feature | Where |
|---|---|
| Multi-tenant client switcher (colored dots, live unread badges, free-tier tracker + Upgrade CTA) | `client/src/components/SidebarHero.jsx` |
| SOP & Brand Vault (searchable cards + split-pane markdown editor with live preview) | `client/src/pages/SopsPage.jsx` |
| Encrypted Credentials Locker (masked `••••••••` by default, 10s timed Reveal) | `client/src/pages/CredentialsPage.jsx` |
| 3-column Task Board + **Scope Meter** (`hours_used` vs `contract_hours`, done-tasks feed the meter) | `client/src/pages/TasksPage.jsx` |
| Webhook "Pulse" widget (Slack/Email/WhatsApp queues, one-click **Clear Feed**) | `client/src/components/PulseWidget.jsx` |
| Free tier = 2 workspaces (server-enforced `402` upsell) | `server/middleware/planLimits.js` |

## API
All endpoints under `/api` (Vite proxies to `:3001`). Bearer-JWT protected.
- `POST /api/auth/register|login`, `GET /api/auth/me`
- `GET/POST /api/workspaces`, `GET/PATCH/DELETE /api/workspaces/:id`
- `GET/POST /api/workspaces/:id/sops`, `GET/PUT/DELETE …/sops/:sopId`
- `GET/POST /api/workspaces/:id/credentials`, `POST …/:credId/reveal` (dedicated decrypt), `DELETE …/:credId`
- `GET/POST/PATCH/DELETE /api/workspaces/:id/tasks[/:taskId]` (task estimates are forecasting only — the meter derives from actuals)
- `GET/POST /api/workspaces/:id/time-logs`, `DELETE …/logs/:logId` (trust-based time tracking)
- `GET /api/workspaces/:id/pulse`, `POST …/pulse/simulate`, `POST …/pulse/clear`

## Security notes
- Credential secrets are never returned by list endpoints — decryption happens only via the explicit `/reveal` route.
- Workspace ownership is enforced per-request by middleware (`authRequired` → `workspaceScope`); ownership is never encoded into the JWT.
- Rotate `JWT_SECRET` and `ENCRYPTION_KEY` in `server/.env` before any real use.
- **Production secret policy:** with `NODE_ENV=production` the server *aborts startup* unless `JWT_SECRET` is a real 32+ char value and `ENCRYPTION_KEY` is a valid 64-char hex key (32 bytes). The insecure dev fallbacks exist **only** for local development and are documented in `server/.env`.
