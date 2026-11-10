// Unit tests for the timestamp normalizer (lib/timestamps.js) — Phase 0.2.
// The data layer stores three shapes; every API response must expose one
// canonical ISO 8601 UTC form so the browser never re-implements parsing.
import { toIsoTimestamp } from "./lib/timestamps.js";

let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
};

// 1) SQLite datetime('now') — UTC, no offset, space separator
ok(
  "SQLite format → ISO Z",
  toIsoTimestamp("2026-11-10 07:44:12") === "2026-11-10T07:44:12.000Z",
  `got ${JSON.stringify(toIsoTimestamp("2026-11-10 07:44:12"))}`
);

// 2) Postgres now()::text — space separator, fractional seconds, "+00" offset
ok(
  "Postgres format → ISO Z",
  toIsoTimestamp("2026-11-10 07:44:12.812+00") === "2026-11-10T07:44:12.812Z",
  `got ${JSON.stringify(toIsoTimestamp("2026-11-10 07:44:12.812+00"))}`
);

// 3) ISO with Z (values written from JS, e.g. SOP editor updated_at) is canonical and unchanged
ok(
  "ISO with Z preserved",
  toIsoTimestamp("2026-11-10T09:00:00.000Z") === "2026-11-10T09:00:00.000Z",
  `got ${JSON.stringify(toIsoTimestamp("2026-11-10T09:00:00.000Z"))}`
);

// 4) ISO without milliseconds normalized into the canonical millisecond form
ok(
  "ISO without millis → with millis",
  toIsoTimestamp("2026-11-10T09:00:00Z") === "2026-11-10T09:00:00.000Z",
  `got ${JSON.stringify(toIsoTimestamp("2026-11-10T09:00:00Z"))}`
);

// 5) Postgres offset with minutes (non-UTC server timezone) converts correctly (+03:30 → subtracted)
ok(
  "Postgres +0330 offset → UTC Z",
  toIsoTimestamp("2026-11-10 10:14:00.000+0330") === "2026-11-10T06:44:00.000Z",
  `got ${JSON.stringify(toIsoTimestamp("2026-11-10 10:14:00.000+0330"))}`
);

// 6) Non-numeric offset form "+00" (colon-less) also accepted
ok(
  "Postgres colon-less +00 offset → ISO Z",
  toIsoTimestamp("2026-11-10 07:44:12+00") === "2026-11-10T07:44:12.000Z",
  `got ${JSON.stringify(toIsoTimestamp("2026-11-10 07:44:12+00"))}`
);

// 7) Unknown/garbage values are returned untouched (never fabricated)
ok("unparseable value untouched", toIsoTimestamp("not-a-date") === "not-a-date");
ok("null untouched", toIsoTimestamp(null) === null);
ok("empty string untouched", toIsoTimestamp("") === "");

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
