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
import { normalizeRow } from "./lib/timestamps.js";

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

// ── Core async helpers ─────────────────────────────────────────────────────
//
// Phase 0.3 (SQLite): although better-sqlite3 is synchronous, async route
// handlers interleave between statements. A concurrent request's write could
// otherwise land inside another request's OPEN transaction on the shared
// connection. Every statement therefore executes through one promise chain;
// an active transaction occupies the chain for its whole (async) duration so
// other requests serialize BEHIND it instead of interleaving into it.
let sqliteQueue = Promise.resolve();
let sqliteTxDepth = 0;

function sqliteDirect(kind, sql, params) {
  const stmt = sqlite.prepare(sql);
  if (kind === "all") return stmt.all(...params);
  if (kind === "get") return stmt.get(...params);
  return stmt.run(...params);
}

function sqliteExec(kind, sql, params) {
  if (sqliteTxDepth > 0) return sqliteDirect(kind, sql, params); // inside our own tx
  const p = sqliteQueue.then(
    () => sqliteDirect(kind, sql, params),
    () => sqliteDirect(kind, sql, params)
  );
  sqliteQueue = p.catch(() => {});
  return p;
}

/** Normalize better-sqlite3 run info into the { lastID, changes } shape. */
function sqliteInfo(info) {
  return { lastID: info.lastInsertRowid, changes: info.changes };
}

export async function query(sql, params = []) {
  if (IS_POSTGRES) {
    const result = await pool.query(toPostgresSql(sql), params);
    result.rows.forEach(normalizeRow);
    return { rows: result.rows, rowCount: result.rowCount };
  }
  const rows = await sqliteExec("all", sql, params);
  rows.forEach(normalizeRow);
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
  return sqliteInfo(await sqliteExec("run", sql, params));
}

// ── prepare()-shaped API so routes do `.get()/ .all()/ .run()` chains ─────
const adapter = {
  prepare(sql) {
    return {
      // async row fetch (null if none)
      async get(...params) {
        if (IS_POSTGRES) {
          const { rows } = await pool.query(toPostgresSql(sql), params);
          return rows[0] ? normalizeRow(rows[0]) : null;
        }
        return normalizeRow((await sqliteExec("get", sql, params)) ?? null);
      },
      // async rows fetch (array)
      async all(...params) {
        if (IS_POSTGRES) {
          const { rows } = await pool.query(toPostgresSql(sql), params);
          rows.forEach(normalizeRow);
          return rows;
        }
        const rows = await sqliteExec("all", sql, params);
        rows.forEach(normalizeRow);
        return rows;
      },
      async run(...params) {
        return run(sql, params);
      },
    };
  },

  /**
   * Phase 0.3: REAL transactions on both dialects.
   *
   * Postgres: the callback receives a db-shaped object bound to the tx's own
   * client. (Previously callbacks ran statements on the POOL — a different
   * connection — so BEGIN/COMMIT wrapped nothing and a mid-tx failure left
   * partial writes.)
   *
   * SQLite: true BEGIN/COMMIT/ROLLBACK on the connection, serialized through
   * the statement queue so concurrent async requests cannot interleave
   * inside the transaction; the callback also receives a bound db object.
   */
  async tx(fn) {
    if (IS_POSTGRES) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(makeTxDb(client));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        // A failed ROLLBACK must not mask the original error.
        try {
          await client.query("ROLLBACK");
        } catch {
          /* transaction already aborted */
        }
        throw err;
      } finally {
        client.release();
      }
    }
    // SQLite
    const exec = async () => {
      sqlite.prepare("BEGIN").run();
      sqliteTxDepth++;
      try {
        const result = await fn(makeTxDb(null));
        sqlite.prepare("COMMIT").run();
        return result;
      } catch (err) {
        try {
          sqlite.prepare("ROLLBACK").run();
        } catch {
          /* transaction already aborted */
        }
        throw err;
      } finally {
        sqliteTxDepth--;
      }
    };
    const p = sqliteQueue.then(exec, exec);
    sqliteQueue = p.catch(() => {});
    return p;
  },
};

/**
 * db-shaped object confined to a transaction's executor, handed to db.tx()
 * callbacks. Postgres statements run on the tx client (NOT the ambient
 * pool); SQLite statements run directly on the connection — safe there
 * because the tx owns the statement queue for its duration.
 */
function makeTxDb(client) {
  const runOne = async (sql, params) => {
    if (client) {
      const result = await client.query(toPostgresSql(sql), params);
      return { lastID: result.rows.length === 1 ? result.rows[0].id : null, changes: result.rowCount };
    }
    return sqliteInfo(sqlite.prepare(sql).run(...params));
  };
  return {
    async query(sql, params = []) {
      if (client) {
        const result = await client.query(toPostgresSql(sql), params);
        result.rows.forEach(normalizeRow);
        return { rows: result.rows, rowCount: result.rowCount };
      }
      const rows = sqlite.prepare(sql).all(...params);
      rows.forEach(normalizeRow);
      return { rows, rowCount: rows.length };
    },
    run: runOne,
    prepare(sql) {
      return {
        async get(...params) {
          if (client) {
            const { rows } = await client.query(toPostgresSql(sql), params);
            return rows[0] ? normalizeRow(rows[0]) : null;
          }
          return normalizeRow(sqlite.prepare(sql).get(...params) ?? null);
        },
        async all(...params) {
          if (client) {
            const { rows } = await client.query(toPostgresSql(sql), params);
            rows.forEach(normalizeRow);
            return rows;
          }
          const rows = sqlite.prepare(sql).all(...params);
          rows.forEach(normalizeRow);
          return rows;
        },
        async run(...params) {
          return runOne(sql, params);
        },
      };
    },
    // Nested transactions are not supported — a callback must use the tx db
    // it was given, never call the ambient adapter's tx again.
    async tx() {
      throw new Error("Nested db.tx() calls are not supported");
    },
  };
}

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
