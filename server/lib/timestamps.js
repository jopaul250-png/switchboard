// Timestamp normalizer (Phase 0.2).
//
// The data layer stores timestamps as TEXT in three shapes:
//   SQLite:   "2026-11-10 07:44:12"        — datetime('now'), UTC, no offset
//   Postgres: "2026-11-10 07:44:12.812+00" — now()::text, space separator
//   JS write: "2026-11-10T09:00:00.000Z"   — new Date().toISOString() (SOP edits)
//
// The browser previously appended "Z" assuming the SQLite shape, which broke on
// the other two ("…+00Z" and "…ZZ" → Invalid Date). Instead of teaching every
// consumer to parse, all API responses expose ONE canonical form:
// ISO 8601 UTC with milliseconds and a trailing "Z".
//
// SQLite's datetime('now') and our JS writes are always UTC, so a missing
// offset is interpreted as UTC (documented assumption, matches how the values
// were produced). Unknown formats are returned untouched — never fabricated.

const SPACE_SEP =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;
const ISO_SEP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

function finalize(date) {
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toIsoTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return value;
  const v = value.trim();

  // Already an ISO-8601 datetime with an explicit offset → canonicalize (adds
  // milliseconds when missing, converts any offset to UTC "Z").
  if (ISO_SEP.test(v)) return finalize(new Date(v)) ?? value;

  // Space-separated (SQLite / Postgres now()::text).
  const m = v.match(SPACE_SEP);
  if (!m) return value;
  const [, date, time, frac = "", tzRaw = ""] = m;
  const ms = frac ? "." + frac.slice(0, 3).padEnd(3, "0") : ".000";
  let off = tzRaw.toUpperCase() || "Z";
  if (/^[+-]\d{2}$/.test(off)) off += ":00"; // "+00" → "+00:00" (strict ISO)
  if (off === "-00:00" || off === "+00:00") off = "Z";
  return finalize(new Date(`${date}T${time}${ms}${off}`)) ?? value;
}

/** String fields whose names end in "_at" carry timestamps in every table. */
const TS_FIELD = /_at$/;

export function normalizeRow(row) {
  if (!row || typeof row !== "object") return row;
  for (const key of Object.keys(row)) {
    if (TS_FIELD.test(key) && typeof row[key] === "string") {
      row[key] = toIsoTimestamp(row[key]);
    }
  }
  return row;
}
