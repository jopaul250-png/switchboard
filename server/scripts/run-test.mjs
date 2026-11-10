// Test runner: boots the Switchboard API as a child process on a FREE port
// against a THROWAWAY database (SQLite temp file by default, or a LOCAL
// Postgres when SMOKE_TARGET=postgres), waits for /api/health, then runs each
// requested test file with SMOKE_API_BASE pointing at the fresh server.
//
// Guarantees:
//  - the API server that tests hit was started by THIS run (no stale server);
//  - if the server fails to boot, the run fails loudly with the server's stderr;
//  - DATABASE_URL is set EXPLICITLY in every mode ("" for SQLite) so no
//    environment value or server/.env value can leak into the server process
//    (dotenv never overrides an existing variable);
//  - Postgres targets are REFUSED unless the host is localhost/127.0.0.1/::1 —
//    tests, migrations and seeds run against local databases only;
//  - local SQLite runs never touch server/data/switchboard.db (SQLITE_PATH
//    points at temp files that are deleted afterwards);
//  - a second, production-mode boot (NODE_ENV=production, throwaway DB) proves
//    the test-only failure-injection hook is unreachable in production.
//
// Usage: node scripts/run-test.mjs [testFile1.mjs testFile2.mjs ...]
//        (defaults to every *.test.mjs in the server directory)
// Note: test-only injection (SWITCHBOARD_ALLOW_TX_INJECTION=1) is enabled for
// server processes spawned here; it only permits injected failures when a
// special request header is also sent AND the server is not in production
// mode, so production boots are unaffected.

import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = process.argv.slice(2);
const targets = files.length
  ? files
  : fs
      .readdirSync(SERVER_DIR)
      .filter((f) => f.endsWith(".test.mjs") && f !== "injection-guard.test.mjs")
      .sort();
const GUARD_TEST = "injection-guard.test.mjs";

// Fake-but-valid test secrets (never real credentials; committed by design for CI).
const TEST_JWT_SECRET = "ci_test_secret_32_characters_minimum_required";
const TEST_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(port, child, deadlineMs = 30000) {
  const deadline = Date.now() + deadlineMs;
  const url = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited (code ${child.exitCode}) before becoming healthy`);
    }
    try {
      const res = await fetch(url);
      const body = await res.json().catch(() => null);
      if (res.status === 200 && body?.ok === true) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`Server did not become healthy within ${deadlineMs}ms`);
}

async function bootServer(childEnv) {
  const port = await getFreePort();
  const server = spawn(process.execPath, ["index.js"], {
    cwd: SERVER_DIR,
    env: { ...childEnv, PORT: String(port) },
    stdio: "pipe",
  });
  let err = "";
  server.stderr.on("data", (d) => (err += String(d)));
  try {
    await waitForHealth(port, server);
  } catch (e) {
    server.kill();
    console.error(`# BOOT FAILURE: ${e.message}`);
    if (err.trim()) console.error(`# ---- server stderr ----\n${err.trim()}`);
    throw e;
  }
  return { server, port };
}

async function runFiles(port, files, childEnv) {
  for (const file of files) {
    console.log(`\n===== ${file} =====`);
    const res = spawn(process.execPath, [file], {
      cwd: SERVER_DIR,
      env: { ...childEnv, SMOKE_API_BASE: `http://127.0.0.1:${port}/api` },
      stdio: "inherit",
    });
    const code = await new Promise((resolve) => res.on("exit", resolve));
    if (code !== 0) {
      console.error(`# ${file} FAILED (exit ${code})`);
      return false;
    }
  }
  return true;
}

(async () => {
  // ── Database target selection (security hardening) ─────────────────────
  // Tests run against LOCAL databases only. The target is explicit in every
  // mode; a non-local host refuses to run — never connects.
  //   SMOKE_TARGET=postgres → DATABASE_URL must point at localhost/127.0.0.1
  //                           (CI service container or a local dev Postgres)
  //   default / =sqlite     → SQLite throwaway temp file; DATABASE_URL=""
  const target = process.env.SMOKE_TARGET === "postgres" ? "postgres" : "sqlite";
  const rawUrl = process.env.DATABASE_URL || "";

  if (target === "postgres") {
    if (!rawUrl) {
      console.error("# REFUSED: SMOKE_TARGET=postgres but DATABASE_URL is not set");
      process.exit(1);
    }
    let host = "";
    try {
      host = new URL(rawUrl).hostname;
    } catch {
      console.error("# REFUSED: DATABASE_URL is not a parseable URL");
      process.exit(1);
    }
    if (!/^localhost$|^127\.0\.0\.1$|^::1$|^\[::1\]$/.test(host)) {
      // Never print the URL — the host name alone is enough to diagnose.
      console.error(
        `# REFUSED: DATABASE_URL host "${host}" is not localhost/127.0.0.1 — tests run against local databases only`
      );
      process.exit(1);
    }
    console.log(`# target: Postgres (${rawUrl.replace(/:[^:@/]+@/, ":***@")})`);
  } else {
    console.log(`# target: SQLite (${rawUrl ? "SMOKE_TARGET=sqlite overrides DATABASE_URL" : "no DATABASE_URL"})`);
  }

  const isPostgres = target === "postgres";

  const env = {
    ...process.env,
    JWT_SECRET: TEST_JWT_SECRET,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    SWITCHBOARD_ALLOW_TX_INJECTION: "1", // header-gated + NODE_ENV-gated
    DATABASE_URL: isPostgres ? rawUrl : "", // explicit in EVERY mode (leak-proof)
  };

  // Fresh throwaway SQLite files; never server/data/switchboard.db
  const sqliteFile = path.join(os.tmpdir(), `switchboard-test-${Date.now()}-${process.pid}.db`);
  const prodFile = path.join(os.tmpdir(), `switchboard-test-prod-${Date.now()}-${process.pid}.db`);
  if (!isPostgres) env.SQLITE_PATH = sqliteFile;
  const cleanupFiles = [sqliteFile, prodFile].flatMap((f) => [f, `${f}-wal`, `${f}-shm`]);

  let failed = false;
  try {
    // Stage 1 — dev/test-mode server: the full suite.
    const { server, port } = await bootServer(env);
    console.log("# server healthy");
    try {
      failed = !(await runFiles(port, targets, env));
    } finally {
      server.kill();
      await sleep(300);
    }

    // Stage 2 — production-mode guard server (local, throwaway DB, TEST
    // secrets): proves the test-only failure-injection hook is unreachable
    // with NODE_ENV=production even when SWITCHBOARD_ALLOW_TX_INJECTION=1.
    if (!failed && fs.existsSync(path.join(SERVER_DIR, GUARD_TEST))) {
      const prodEnv = {
        ...env,
        NODE_ENV: "production",
        ...(isPostgres ? {} : { SQLITE_PATH: prodFile }),
      };
      console.log("\n# production-mode injection guard (local server, NODE_ENV=production)");
      const { server: prodServer, port: prodPort } = await bootServer(prodEnv);
      console.log("# prod-mode server healthy");
      try {
        failed = !(await runFiles(prodPort, [GUARD_TEST], prodEnv));
      } finally {
        prodServer.kill();
        await sleep(300);
      }
    }
  } catch {
    failed = true;
  }

  await sleep(100);
  for (const f of cleanupFiles) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* best effort */
    }
  }

  if (failed) process.exit(1);
  console.log("\n# all test files passed");
})().catch((e) => {
  console.error("RUNNER ERROR:", e);
  process.exit(1);
});
