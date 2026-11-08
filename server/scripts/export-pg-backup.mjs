// Manual backup/export for Supabase Free (no automated backups on that plan).
//
// Usage:
//   DATABASE_URL="postgresql://..." node scripts/export-pg-backup.mjs
//   → writes backups/switchboard-YYYY-MM-DD-HHmmss.json containing every table.
//
// Restore path: the JSON shape is [table][rows]; a restore script can rebuild
// tables from schema.postgres.sql + this file. Run weekly during beta, and
// ALWAYS before any risky change (key rotation, schema change, reset).
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TARGET_URL = process.env.DATABASE_URL || "";
if (!/^postgres(ql)?:\/\//.test(TARGET_URL)) {
  console.error("ERROR: set DATABASE_URL to the Supabase POOLED connection string.");
  process.exit(1);
}

const TABLES = [
  "users",
  "client_workspaces",
  "sop_documents",
  "secure_credentials",
  "task_lists",
  "pulse_feeds",
  "time_logs",
];

async function main() {
  const client = new pg.Client({ connectionString: TARGET_URL });
  await client.connect();

  const dump = { exported_at: new Date().toISOString(), tables: {} };
  for (const table of TABLES) {
    const { rows } = await client.query(`SELECT * FROM "${table}" ORDER BY id`);
    dump.tables[table] = rows;
    console.log(`  ${table}: ${rows.length} row(s)`);
  }
  await client.end();

  const dir = path.join(__dirname, "..", "backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(dir, `switchboard-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`\n[backup] written: ${file}`);
}

main().catch((err) => {
  console.error("[backup] FAILED:", err);
  process.exit(1);
});
