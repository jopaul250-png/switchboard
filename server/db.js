import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "switchboard.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);

  // P2 accounting model: manual scope adjustments are recorded separately
  // from tracked time (actuals live in time_logs only).
  const cols = db.prepare("PRAGMA table_info(client_workspaces)").all().map((c) => c.name);
  if (!cols.includes("hours_manual")) {
    db.exec("ALTER TABLE client_workspaces ADD COLUMN hours_manual REAL NOT NULL DEFAULT 0");
  }
}

// Seed pulse queues for a new workspace so the Pulse widget has all channels
export function seedPulseQueues(workspaceId) {
  const seed = db.prepare(
    "INSERT OR IGNORE INTO pulse_feeds (workspace_id, channel) VALUES (?, ?)"
  );
  for (const channel of ["Slack", "Email", "WhatsApp"]) seed.run(workspaceId, channel);
}

// Aggregated workspace stats used by /workspaces list and detail
export function workspaceSummary(workspace) {
  const unread = db
    .prepare(
      "SELECT COALESCE(SUM(unread_count), 0) AS total FROM pulse_feeds WHERE workspace_id = ?"
    )
    .get(workspace.id).total;
  return {
    ...workspace,
    pulse_unread: unread,
  };
}

export default db;
