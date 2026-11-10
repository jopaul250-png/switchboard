// Database access layer.
//
// Postgres (Supabase Production): DATABASE_URL starts with postgres:// or
// postgresql:// → async `pg` pool. ?-placeholders are translated to $N.
// SQLite (local dev / CI fallback): no DATABASE_URL → better-sqlite3 keeps
// working with pinned version numbers preserved in node_modules.
//
// Migration path (P2): `migrate()` applies schema.postgres.sql on Postgres
// and schema.sql on SQLite. Both are idempotent (IF NOT EXISTS).
//
// Every data call is async. Local SQLite results are returned synchronously
// to the adapter which normalizes them into promises for callers.
import { Pool } from "pg";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL || "";
const IS_POSTGRES = /^postgres(ql)?:\/\//.test(DATABASE_URL);

let pool;
let sqlite;

if (IS_POSTGRES) {
  // Supabase pooled connection (PgBouncer). Reserved (direct) connection
  // string must never be used by the app server so that migrations can run
  // concurrently without contention.
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
} else {
  // SQLITE_PATH override exists so test runs can use a fresh throwaway DB
  // file without ever touching the developer's local database.
  const dbFile = process.env.SQLITE_PATH || path.join(__dirname, "data", "switchboard.db");
  const dataDir = process.env.SQLITE_PATH ? path.dirname(dbFile) : path.join(__dirname, "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  sqlite = new Database(dbFile);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
}

/** Convert `?` placeholders to `$N` for Postgres. SQLite is untouched. */
function toPostgresSql(sql) {
  if (!IS_POSTGRES) return sql;
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ── Core async helpers ────────────────────────────────────────────────────
export async function query(sql, params = []) {
  if (IS_POSTGRES) {
    const result = await pool.query(toPostgresSql(sql), params);
    return { rows: result.rows, rowCount: result.rowCount };
  }
  const rows = sqlite.prepare(sql).all(...params);
  return { rows, rowCount: rows.length };
}

/**
 * INSERT helpers return the inserted primary key via `lastID`
 * (INSERT ... RETURNING id works on both dialects; SQLite 3.35+).
 */
export async function run(sql, params = []) {
  if (IS_POSTGRES) {
    const result = await pool.query(toPostgresSql(sql), params);
    return { lastID: result.rows.length === 1 ? result.rows[0].id : null, changes: result.rowCount };
  }
  const info = sqlite.prepare(sql).run(...params);
  // Appendix: RETURNING style INSERTs expose the id in result.rows.
  // Fall back to lastInsertRowid when the statement does not use RETURNING.
  const lastID = info.lastInsertRowid;
  return { lastID, changes: info.changes };
}

// ── prepare()-shaped API so routes do `.get()/ .all()/ .run()` chains ─────
const adapter = {
  prepare(sql) {
    return {
      // async row fetch (null if none)
      async get(...params) {
        if (IS_POSTGRES) {
          const { rows } = await pool.query(toPostgresSql(sql), params);
          return rows[0] ?? null;
        }
        return sqlite.prepare(sql).get(...params) ?? null;
      },
      // async rows fetch (array)
      async all(...params) {
        if (IS_POSTGRES) {
          const { rows } = await pool.query(toPostgresSql(sql), params);
          return rows;
        }
        return sqlite.prepare(sql).all(...params);
      },
      async run(...params) {
        return run(sql, params);
      },
    };
  },

  /**
   * Transaction wrapper (single-instance beta: serial execution is safe).
   * Postgres: BEGIN/COMMIT with rollback on error.
   * SQLite: native better-sqlite3 transaction.
   */
  async tx(fn) {
    if (IS_POSTGRES) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
    // SQLite: run statements synchronously inside an implicit transaction.
    // (Concurrency-free single process — no rollback needed in dev.)
    return fn();
  },
};

export default adapter;

// ── Schema migration ─────────────────────────────────────────────────────
export async function migrate() {
  if (IS_POSTGRES) {
    // schema.postgres.sql uses TEXT timestamps. Defaults must be cast
    // explicitly (now()::text) inside the migration file.
    const schema = fs.readFileSync(path.join(__dirname, "schema.postgres.sql"), "utf8");
    await pool.query(schema);
    // Idempotent backfill of hours_manual (P2 accounting model).
    const cols = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'client_workspaces'"
    );
    if (!cols.rows.some((c) => c.column_name === "hours_manual")) {
      await pool.query("ALTER TABLE client_workspaces ADD COLUMN hours_manual REAL NOT NULL DEFAULT 0");
    }
    console.log("[switchboard] database: Postgres schema ready");
    return;
  }
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  sqlite.exec(schema);
  // P2 accounting model: manual scope adjustments recorded separately
  const cols = sqlite.prepare("PRAGMA table_info(client_workspaces)").all().map((c) => c.name);
  if (!cols.includes("hours_manual")) {
    sqlite.exec("ALTER TABLE client_workspaces ADD COLUMN hours_manual REAL NOT NULL DEFAULT 0");
  }
  console.log("[switchboard] database: SQLite schema ready (local dev)");
}

// Seed pulse queues for a new workspace so the Pulse widget has all channels
// client (optional): a tx-scoped pg client; defaults to the pool.
export async function seedPulseQueues(workspaceId, client = null) {
  const executor = client ?? (IS_POSTGRES ? pool : null);
  const channels = ["Slack", "Email", "WhatsApp"];
  for (const channel of channels) {
    if (IS_POSTGRES) {
      await executor.query(
        "INSERT INTO pulse_feeds (workspace_id, channel) VALUES ($1, $2) ON CONFLICT (workspace_id, channel) DO NOTHING",
        [workspaceId, channel]
      );
    } else {
      sqlite
        .prepare("INSERT OR IGNORE INTO pulse_feeds (workspace_id, channel) VALUES (?, ?)")
        .run(workspaceId, channel);
    }
  }
}
