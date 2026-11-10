// Unit tests for the test-run database target guard (security item 4).
// The guard must use a real URL parser and refuse every form of a non-local
// or host-overriding connection string before any connection is attempted.
import { resolveDbTarget } from "./lib/dbTarget.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

// ── SQLite mode pins DATABASE_URL away (leak-proof) ─────────────────────────
{
  const r = resolveDbTarget({ smokeTarget: undefined, databaseUrl: "postgres://u:p@db.example.supabase.co:6543/postgres" });
  ok("default target is sqlite even when a remote DATABASE_URL is ambient", r.target === "sqlite" && r.databaseUrl === "", JSON.stringify(r));
}
{
  const r = resolveDbTarget({ smokeTarget: "sqlite", databaseUrl: "postgres://u:p@localhost:5432/db" });
  ok("explicit sqlite still pins DATABASE_URL to empty", r.target === "sqlite" && r.databaseUrl === "", JSON.stringify(r));
}

// ── Postgres mode: valid local URLs pass through unchanged ──────────────────
{
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "postgres://u:p@localhost:5432/db" });
  ok("localhost URL allowed", !r.error && r.target === "postgres" && r.databaseUrl === "postgres://u:p@localhost:5432/db", JSON.stringify(r));
}
{
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "postgres://u:p@127.0.0.1:5432/switchboard_test" });
  ok("127.0.0.1 URL allowed", !r.error && r.databaseUrl === "postgres://u:p@127.0.0.1:5432/switchboard_test", JSON.stringify(r));
}
{
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "postgresql://u:p@[::1]:5432/db" });
  ok("IPv6 ::1 URL allowed", !r.error && r.databaseUrl === "postgresql://u:p@[::1]:5432/db", JSON.stringify(r));
}
{
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "postgres://u:p@localhost:5432/db?sslmode=require&connect_timeout=10" });
  ok("harmless query params allowed", !r.error, JSON.stringify(r));
}

// ── Postgres mode: remote URLs refused ──────────────────────────────────────
{
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "postgres://u:p@db.example.supabase.co:6543/postgres" });
  ok("remote hostname refused", !!r.error && /not localhost/.test(r.error), JSON.stringify(r));
}

// ── The two specific bypasses from the security review ──────────────────────
{
  // "localhost" here is the USERNAME; the real connect host is evil.example.
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "postgres://localhost@evil.example/db" });
  ok("user-info trick refused (postgres://localhost@evil.example/db)", !!r.error && /evil\.example/.test(r.error), JSON.stringify(r));
}
{
  // pg connection strings honor ?host= as the actual connect target.
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "postgres://u:p@127.0.0.1:5432/db?host=evil.example" });
  ok("?host= query override refused", !!r.error && /host=/.test(r.error), JSON.stringify(r));
}
{
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "postgres://u:p@127.0.0.1:5432/db?hostaddr=10.0.0.5" });
  ok("?hostaddr= query override refused", !!r.error && /hostaddr=/.test(r.error), JSON.stringify(r));
}

// ── Postgres mode: malformed / missing refused ───────────────────────────────
{
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "" });
  ok("missing DATABASE_URL refused", !!r.error && /not set/.test(r.error), JSON.stringify(r));
}
{
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "not-a-url" });
  ok("unparseable DATABASE_URL refused", !!r.error && /parseable/.test(r.error), JSON.stringify(r));
}
{
  const r = resolveDbTarget({ smokeTarget: "postgres", databaseUrl: "postgres:///db" });
  ok("empty-host URL refused", !!r.error, JSON.stringify(r));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
