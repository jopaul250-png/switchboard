// One-off migration: SQLite (server/data/switchboard.db) → PostgreSQL (Supabase).
//
// Usage:
//   SUPABASE_MIGRATION_URL="postgresql://..." node scripts/migrate-sqlite-to-pg.mjs
//   (use the DIRECT connection string from Supabase, not the pooled one)
//
// Scope (per the Phase 2 plan):
//   - INCLUDED: users 6 (ava@switchboard.dev) and 7 (metm2992@gmail.com) and
//     every workspace/SOP/credential/task/pulse/time-log those users own.
//   - EXCLUDED: smoke-test residue (users 1-5, 8-15; workspaces 1-9, 17).
//   - EXCLUDED by default: the 2.5h of SYNTHETIC demo time logs on the
//     recreated Summit workspace (id 31) — they were never stopwatch-tracked.
//     Pass --include-synthetic to override.
//
// Behavior:
//   1. Applies schema.postgres.sql (idempotent) to the target.
//   2. Refuses to insert if the target already has data (use --force to allow).
//   3. Copies rows with IDs PRESERVED (all FK relationships stay intact).
//   4. Resets Postgres sequences past the max id (SERIAL continues correctly).
//   5. Verifies: count comparison SQLite vs Postgres for every table.
//
// Encrypted credentials: enc_payload blobs are copied byte-for-byte as text.
// They decrypt only with the SAME ENCRYPTION_KEY — carry it over unchanged.
import pg from "pg";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TARGET_URL = process.env.SUPABASE_MIGRATION_URL || process.env.DATABASE_URL || "";
const INCLUDE_SYNTHETIC = process.argv.includes("--include-synthetic");
const FORCE = process.argv.includes("--force");

if (!/^postgres(ql)?:\/\//.test(TARGET_URL)) {
  console.error(
    "ERROR: pass the Supabase DIRECT connection string as SUPABASE_MIGRATION_URL\n" +
      "  (Supabase Dashboard → Project Settings → Database → Connection string → URI)"
  );
  process.exit(1);
}

const KEEP_USER_IDS = [6, 7]; // ava demo account + real testing account
const SUMMIT_WS_ID = 31; // demo workspace whose logs are synthetic

const sqlite = new Database(path.join(__dirname, "..", "data", "switchboard.db"), {
  readonly: true,
});
const target = new pg.Client({ connectionString: TARGET_URL });

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
  console.log(`[migrate] target: ${TARGET_URL.replace(/:[^:@/]+@/, ":****@")}`);
  await target.connect();

  // 1) Schema (idempotent)
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.postgres.sql"), "utf8");
  await target.query(schema);
  console.log("[migrate] schema.postgres.sql applied");

  // 2) Safety: refuse to stack data on an already-populated target
  const counts = await target.query(
    `SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM client_workspaces) w`
  );
  if (counts.rows[0].u > 0 || counts.rows[0].w > 0) {
    if (!FORCE) {
      console.error(
        `[migrate] ABORT: target already has users=${counts.rows[0].u} workspaces=${counts.rows[0].w}.\n` +
          "  Re-run with --force only if you know the existing data is disposable."
      );
      process.exit(1);
    }
    console.warn("[migrate] --force set: proceeding despite existing rows");
  }

  // 3) Copy rows, ids preserved, FK-safe order (matches TABLES order)
  for (const table of TABLES) {
    let rows;
    let params = [];
    if (table === "users") {
      rows = sqlite
        .prepare(`SELECT * FROM users WHERE id IN (${KEEP_USER_IDS.map(() => "?").join(",")})`)
        .all(...KEEP_USER_IDS);
      params = rows;
    } else if (table === "client_workspaces") {
      rows = sqlite
        .prepare(`SELECT * FROM client_workspaces WHERE owner_id IN (${KEEP_USER_IDS.map(() => "?").join(",")})`)
        .all(...KEEP_USER_IDS);
    } else {
      // child tables scoped via their workspace's ownership
      rows = sqlite
        .prepare(
          `SELECT t.* FROM ${table} t
           JOIN client_workspaces w ON w.id = t.workspace_id
           WHERE w.owner_id IN (${KEEP_USER_IDS.map(() => "?").join(",")})`
        )
        .all(...KEEP_USER_IDS);
      if (table === "time_logs" && !INCLUDE_SYNTHETIC) {
        const before = rows.length;
        rows = rows.filter((r) => !(r.workspace_id === SUMMIT_WS_ID));
        console.log(
          `[migrate] time_logs: excluded ${before - rows.length} synthetic Summit demo log(s) ` +
            "(pass --include-synthetic to keep them)"
        );
      }
    }

    let inserted = 0;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = Object.values(row);
      const colSql = cols.map((c) => `"${c}"`).join(", ");
      const phSql = cols.map((_, i) => `$${i + 1}`).join(", ");
      await target.query(
        `INSERT INTO "${table}" (${colSql}) VALUES (${phSql}) ON CONFLICT DO NOTHING`,
        vals
      );
      inserted++;
    }

    // 4) Reset the identity sequence beyond the highest copied id
    if (rows.length > 0) {
      const maxId = Math.max(...rows.map((r) => Number(r.id)));
      await target.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), $1, true)`,
        [maxId]
      );
    }
    console.log(`[migrate] ${table}: ${inserted} row(s) inserted`);
  }

  // 5) Verification: SQLite source counts vs Postgres target counts
  console.log("\n[migrate] verification (sqlite-source / postgres-target):");
  let mismatches = 0;
  const wsIds = sqlite
    .prepare(`SELECT id FROM client_workspaces WHERE owner_id IN (6,7)`)
    .all()
    .map((r) => r.id);
  for (const table of TABLES) {
    let sourceCount;
    if (table === "users") {
      sourceCount = sqlite.prepare(`SELECT COUNT(*) c FROM users WHERE id IN (6,7)`).get().c;
    } else if (table === "client_workspaces") {
      sourceCount = wsIds.length;
    } else {
      sourceCount = sqlite
        .prepare(
          `SELECT COUNT(*) c FROM ${table} t JOIN client_workspaces w ON w.id = t.workspace_id WHERE w.owner_id IN (6,7)`
        )
        .get().c;
      if (table === "time_logs" && !INCLUDE_SYNTHETIC) {
        sourceCount = sqlite
          .prepare(
            `SELECT COUNT(*) c FROM ${table} t JOIN client_workspaces w ON w.id = t.workspace_id WHERE w.owner_id IN (6,7) AND t.workspace_id != ${SUMMIT_WS_ID}`
          )
          .get().c;
      }
    }
    const { rows } = await target.query(`SELECT COUNT(*) c FROM "${table}"`);
    const match = Number(rows[0].c) === sourceCount;
    if (!match) mismatches++;
    console.log(
      `  ${match ? "✓" : "✗"} ${table}: ${sourceCount} / ${rows[0].c}${match ? "" : "  MISMATCH"}`
    );
  }

  await target.end();
  if (mismatches > 0) {
    console.error(`\n[migrate] FAILED: ${mismatches} table(s) mismatched.`);
    process.exit(1);
  }
  console.log("\n[migrate] OK: migration complete. Re-run the smoke suite against this URL next.");
}

main().catch((err) => {
  console.error("[migrate] FAILED:", err);
  process.exit(1);
});
