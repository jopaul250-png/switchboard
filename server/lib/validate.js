/**
 * Input validation helpers (Phase 1.4). Type/length checks happen at the API
 * edge so garbage never reaches SQL, crypto, or the DB driver. Every helper
 * returns { value } on success or { error } on failure — routes aggregate.
 */
export function strField(raw, { name = "value", max = 255, min = 0, required = false } = {}) {
  const s = typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : String(raw).trim();
  if (!s) return required ? { error: `${name} is required` } : { value: "" };
  if (s.length < min) return { error: `${name} is too short (min ${min})` };
  if (s.length > max) return { error: `${name} is too long (max ${max} chars)` };
  return { value: s };
}

export function numField(raw, { name = "value", min = 0, max = 1_000_000_000, integer = false, fallback } = {}) {
  if (raw === undefined || raw === null || raw === "") {
    return fallback !== undefined ? { value: fallback } : { error: `${name} is required` };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return { error: `${name} must be a number` };
  if (integer && !Number.isInteger(n)) return { error: `${name} must be a whole number` };
  if (n < min || n > max) return { error: `${name} must be between ${min} and ${max}` };
  return { value: n };
}

export function enumField(raw, allowed, { name = "value", fallback } = {}) {
  if ((raw === undefined || raw === null || raw === "") && fallback !== undefined) return { value: fallback };
  if (!allowed.includes(raw)) return { error: `${name} must be one of: ${allowed.join(", ")}` };
  return { value: raw };
}

/**
 * ISO 8601 datetime check (Phase 1.4). Returns { value: originalString } on
 * success (kept verbatim so the DB stores what the client sent), { value: null }
 * when empty and not required, or { error }.
 */
export function dateField(raw, { name = "value", required = false } = {}) {
  if (raw === undefined || raw === null || raw === "") {
    return required ? { error: `${name} is required` } : { value: null };
  }
  const s = String(raw).trim();
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s);
  if (!iso || Number.isNaN(new Date(s).getTime())) {
    return { error: `${name} must be a valid ISO 8601 datetime (e.g. 2026-01-15T10:00:00Z)` };
  }
  return { value: s };
}