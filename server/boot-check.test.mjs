// Phase 1.4 — production boot REQUIRES CORS_ORIGIN.
//
// Same discipline as the JWT_SECRET / ENCRYPTION_KEY boot checks: a
// production server that starts without an explicit origin allowlist runs
// the CORS middleware in open mode, letting ANY origin make credentialed
// requests. Bad config must kill startup, not run anyway.
//
// This test spawns a real production-mode boot WITHOUT CORS_ORIGIN and
// expects a nonzero exit with CORS_ORIGIN named on stderr. No DB access
// happens (the check fires before migration) — a throwaway SQLITE_PATH is
// set defensively so the standing "never touch server/data" rule holds even
// if the check were removed.
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

(async () => {
  const tmpDb = path.join(os.tmpdir(), `sb-boot-check-${Date.now()}-${process.pid}.db`);
  const child = spawn(process.execPath, ["index.js"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: "production",
      JWT_SECRET: process.env.JWT_SECRET || "ci_test_secret_32_characters_minimum_required",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      DATABASE_URL: "", // SQLite mode; boot check fires before any DB access
      SQLITE_PATH: tmpDb, // defensive: never server/data/*.db
      // CORS_ORIGIN deliberately ABSENT
    },
    stdio: "pipe",
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += String(d)));
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("timeout"); // booting "successfully" = the bug reproduces
    }, 15000);
    child.on("exit", (c) => {
      clearTimeout(t);
      resolve(c);
    });
  });

  ok("prod-mode boot without CORS_ORIGIN exits nonzero", typeof code === "number" && code !== 0, `got ${code}`);
  ok("stderr names the missing CORS_ORIGIN", /CORS_ORIGIN/.test(stderr), stderr.split("\n")[0]);

  await new Promise((r) => setTimeout(r, 200));
  for (const f of [tmpDb, `${tmpDb}-wal`, `${tmpDb}-shm`]) {
    try { fs.rmSync(f, { force: true }); } catch {}
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
