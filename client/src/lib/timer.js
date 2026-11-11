// Phase 2.2 — stopwatch persistence logic (framework-free, injectable storage).
//
// The stopwatch previously lived ONLY in React state: a refresh or closed
// tab silently destroyed a running session, and elapsed time was a ticking
// counter (setInterval +1) that drifted. Now the START TIMESTAMP is
// persisted per workspace and elapsed time is always COMPUTED from
// Date.now() — never accumulated locally.
//
// Persisted shape (one slot only — a single active timer per browser):
//   {
//     wsId, wsName, desc,     // attribution + description
//     startedAt,              // ISO — original session start (sent as
//                             //        started_at on Stop & Log)
//     segmentStart,           // ISO — when the current running segment began
//     accumulated,            // seconds banked by previous run segments
//     running,                // true while the clock runs
//   }
//
// `storage` is anything with the localStorage surface
// (getItem/setItem/removeItem) so tests can inject a Map fake.
//
// Phase 2.6 — heartbeat + long-gap trust rule:
//   `lastActive` (ISO, optional for pre-2.6 payloads) is refreshed by a
//   30s heartbeat while the page is open. A running session whose
//   lastActive is older than LONG_GAP_MS has a LONG GAP (closed tab,
//   slept laptop): elapsed MUST NOT silently include that gap — the
//   widget offers log-until-last-active / credit / edit / discard.

export const STORAGE_KEY = "switchboard.stopwatch.active.v1";

export const HEARTBEAT_MS = 30_000; // heartbeat while the page is open
export const LONG_GAP_MS = 90_000;  // past this, the gap needs an explicit choice

const iso = (ms) => new Date(ms).toISOString();

/** Read the persisted timer, or null when absent/corrupt (never throws). */
export function loadTimer(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (
      !t ||
      (t.wsId === undefined || t.wsId === null) ||
      typeof t.startedAt !== "string" ||
      Number.isNaN(Date.parse(t.startedAt)) ||
      typeof t.segmentStart !== "string" ||
      Number.isNaN(Date.parse(t.segmentStart)) ||
      !Number.isFinite(t.accumulated) ||
      t.accumulated < 0 ||
      typeof t.running !== "boolean" ||
      // Phase 2.6: lastActive is optional (2.2-era payloads) but must be
      // a valid timestamp when present.
      (t.lastActive !== undefined &&
        (typeof t.lastActive !== "string" || Number.isNaN(Date.parse(t.lastActive))))
    ) {
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

/** Persist a timer (single slot — starting another session replaces this one). */
export function saveTimer(storage, t) {
  storage.setItem(STORAGE_KEY, JSON.stringify(t));
}

/** Discard the persisted timer (the "discard" path of resume-or-discard). */
export function discardTimer(storage) {
  storage.removeItem(STORAGE_KEY);
}

/** Start a new session for a workspace; `now` is wall-clock ms (Date.now()). */
export function startTimer({ wsId, wsName, desc = "" }, now = Date.now()) {
  return {
    wsId,
    wsName,
    desc,
    startedAt: iso(now),
    segmentStart: iso(now),
    accumulated: 0,
    running: true,
    lastActive: iso(now),
  };
}

/** Pause: bank the running segment's seconds; elapsed freezes at `now`. */
export function pauseTimer(t, now = Date.now()) {
  return { ...t, accumulated: elapsedSeconds(t, now), running: false };
}

/** Resume a new running segment; the original startedAt is preserved so the
 *  whole session is attributed to where (and when) it began. */
export function resumeTimer(t, now = Date.now()) {
  return { ...t, segmentStart: iso(now), running: true };
}

/** Elapsed seconds — always derived from the wall clock, floored, clamped ≥ 0.
 *  Running: banked seconds + (now − segmentStart). Paused: banked seconds. */
export function elapsedSeconds(t, now = Date.now()) {
  if (!t.running) return Math.max(0, Math.floor(t.accumulated));
  const segment = (now - Date.parse(t.segmentStart)) / 1000;
  return Math.max(0, Math.floor(t.accumulated + segment));
}

// ── Phase 2.6: heartbeat + long-gap trust rule ──────────────────────────

/** Heartbeat: refresh ONLY lastActive (called every HEARTBEAT_MS while the
 *  page is open and the clock runs, plus on tab-hide). */
export function beatTimer(t, now = Date.now()) {
  return { ...t, lastActive: iso(now) };
}

/** Whole seconds since the last heartbeat (0 when unknown). */
export function gapSeconds(t, now = Date.now()) {
  if (typeof t.lastActive !== "string") return 0;
  return Math.max(0, Math.floor((now - Date.parse(t.lastActive)) / 1000));
}

/** True when a RUNNING session's last heartbeat is older than the threshold
 *  — the user may have been away far longer than the tracker should credit.
 *  Paused sessions never qualify (their elapsed is frozen). */
export function hasLongGap(t, now = Date.now(), thresholdMs = LONG_GAP_MS) {
  if (!t.running) return false;
  if (typeof t.lastActive !== "string") return false;
  return now - Date.parse(t.lastActive) > thresholdMs;
}

/** Elapsed seconds counting ONLY up to the last heartbeat — the honest
 *  "worked so far" number for a session with a possible closed-tab gap. */
export function elapsedUntilLastActive(t) {
  if (!t.running) return Math.max(0, Math.floor(t.accumulated));
  if (typeof t.lastActive !== "string") return elapsedSeconds(t);
  const untilBeat =
    t.accumulated + (Date.parse(t.lastActive) - Date.parse(t.segmentStart)) / 1000;
  return Math.max(0, Math.floor(untilBeat));
}

/** Explicit choice: credit everything through `now` (including the gap) and
 *  keep running from a fresh segment. Attribution (startedAt) is preserved. */
export function creditGap(t, now = Date.now()) {
  return {
    ...t,
    accumulated: elapsedSeconds(t, now),
    segmentStart: iso(now),
    lastActive: iso(now),
  };
}

/** Explicit choice: the user sets the exact credited seconds; the clock then
 *  continues from that amount with a fresh segment. Attribution preserved. */
export function applyDuration(t, seconds, now = Date.now()) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return {
    ...t,
    accumulated: safe,
    segmentStart: iso(now),
    lastActive: iso(now),
  };
}
