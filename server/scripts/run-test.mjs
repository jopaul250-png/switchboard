// Test runner: boots the Switchboard API as a child process on a FREE port
// against a THROWAWAY database (SQLite temp file by default, or Postgres when
// DATABASE_URL is set), waits for /api/health, then runs each requested test
// file with SMOKE_API_BASE pointing at the fresh server.
//
// Guarantees:
//  - the API server that tests hit was started by THIS run (no stale server);
//  - if the server fails to boot, the run fails loudly with the server's stderr;
//  - local SQLite runs never touch server/data/switchboard.db (SQLITE_PATH
//    points at a temp file that is deleted afterwards).
//
// Usage: node scripts/run-test.mjs [testFile1.mjs testFile2.mjs ...]
//        (defaults to smoke.test.mjs)
// Note: test-only injection (SWITCHBOARD_ALLOW_TX_INJECTION=1) is enabled for
// server processes spawned here; it only permits injected failures when a
// special request header is also sent, so production boots are unaffected.

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
      .filter((f) => f.endsWith(".test.mjs"))
      .sort();

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

(async () => {
  const port = await getFreePort();
  const isPostgres = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL || "");
  const base = `http://127.0.0.1:${port}/api`;

  const env = {
    ...process.env,
    PORT: String(port),
    JWT_SECRET: TEST_JWT_SECRET,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    SWITCHBOARD_ALLOW_TX_INJECTION: "1", // header-gated (see header note above)
  };
  if (isPostgres) {
    console.log(`# target: Postgres (${String(process.env.DATABASE_URL).replace(/:[^:@/]+@/, ":***@")})`);
  } else {
    // Fresh throwaway SQLite file; never server/data/switchboard.db
    const dbFile = path.join(os.tmpdir(), `switchboard-test-${Date.now()}-${process.pid}.db`);
    env.SQLITE_PATH = dbFile;
    console.log(`# target: SQLite (${dbFile})`);
  }
  const extraSqlite = env.SQLITE_PATH ? [env.SQLITE_PATH, `${env.SQLITE_PATH}-wal`, `${env.SQLITE_PATH}-shm`] : [];

  console.log(`# server: http://127.0.0.1:${port} (booting)`);
  const server = spawn(process.execPath, ["index.js"], { cwd: SERVER_DIR, env, stdio: "pipe" });
  let serverErr = "";
  server.stderr.on("data", (d) => (serverErr += String(d)));

  let failed = false;
  try {
    await waitForHealth(port, server);
    console.log("# server healthy");

    for (const file of targets) {
      console.log(`\n===== ${file} =====`);
      const res = spawn(process.execPath, [file], {
        cwd: SERVER_DIR,
        env: { ...env, SMOKE_API_BASE: base },
        stdio: "inherit",
      });
      const code = await new Promise((resolve) => res.on("exit", resolve));
      if (code !== 0) {
        console.error(`# ${file} FAILED (exit ${code})`);
        failed = true;
        break;
      }
    }
  } catch (err) {
    console.error(`# BOOT FAILURE: ${err.message}`);
    if (serverErr.trim()) console.error(`# ---- server stderr ----\n${serverErr.trim()}`);
    failed = true;
  } finally {
    server.kill();
    await sleep(300).then(() => {
      for (const f of extraSqlite) {
        try { fs.rmSync(f, { force: true }); } catch { /* best effort */ }
      }
    });
  }

  if (failed) process.exit(1);
  console.log("\n# all test files passed");
})().catch((e) => {
  console.error("RUNNER ERROR:", e);
  process.exit(1);
});
