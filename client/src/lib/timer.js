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

export const STORAGE_KEY = "switchboard.stopwatch.active.v1";

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
      typeof t.running !== "boolean"
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
