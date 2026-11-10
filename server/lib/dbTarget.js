// Database target resolver for test runs (security guard).
//
// Standing rule: tests, migrations and seed scripts run against LOCAL
// databases only — never production. This module resolves the target mode and
// validates the connection string with a REAL URL parser (WHATWG `new URL`,
// the same class of parser that browsers use), refusing anything non-local
// before any connection attempt.
//
// Threats covered:
//   - a remote Supabase/production URL passed via the environment;
//   - user-info tricks: postgres://localhost@evil.example/db  (hostname is
//     evil.example — the "localhost" part is only the username);
//   - query-string overrides: postgres://u:p@127.0.0.1/db?host=evil.example —
//     libpq's connection-string parser treats ?host= (and ?hostaddr=) as the
//     actual connect target, so ANY host/hostaddr query parameter is refused;
//   - leak-through: in SQLite mode the DATABASE_URL is PINNED to "" so no
//     ambient environment value or server/.env value can reach the app.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * @param {object} input
 * @param {string|undefined} input.smokeTarget  "postgres" | anything/undefined (= "sqlite")
 * @param {string|undefined} input.databaseUrl  ambient DATABASE_URL (may be undefined)
 * @returns {{ target: "sqlite"|"postgres", databaseUrl: string, error?: string }}
 *   databaseUrl is the value the runner must pass through: "" for SQLite
 *   (explicit in every mode), the validated URL for Postgres.
 */
export function resolveDbTarget({ smokeTarget, databaseUrl } = {}) {
  const target = smokeTarget === "postgres" ? "postgres" : "sqlite";

  if (target !== "postgres") {
    // Explicit in every mode: an empty string blocks dotenv from injecting
    // server/.env values into the spawned server process.
    return { target, databaseUrl: "" };
  }

  const raw = (databaseUrl || "").trim();
  if (!raw) {
    return { target, error: "SMOKE_TARGET=postgres but DATABASE_URL is not set" };
  }

  let u;
  try {
    u = new URL(raw);
  } catch {
    return { target, error: "DATABASE_URL is not a parseable URL" };
  }

  // Query-parameter host overrides (pg connection strings honor ?host=).
  for (const p of ["host", "hostaddr"]) {
    if (u.searchParams.has(p)) {
      return {
        target,
        error: `DATABASE_URL query parameter "${p}=" is not allowed — it overrides the URL host`,
      };
    }
  }

  // WHATWG URL: "postgres://localhost@evil.example/db" parses with
  // username="localhost" and hostname="evil.example" — hostname is the truth.
  // Non-special schemes keep IPv6 brackets ("[::1]") — strip them explicitly.
  const host = u.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!LOCAL_HOSTS.has(host)) {
    // Host name alone is safe to print — no credentials, no URL.
    return {
      target,
      error: `DATABASE_URL host "${host}" is not localhost/127.0.0.1 — tests run against local databases only`,
    };
  }

  return { target, databaseUrl: raw };
}
