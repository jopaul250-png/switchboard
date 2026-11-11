// Phase 2.2 — stopwatch persistence logic (framework-free module tests).
//
// The stopwatch previously lived ONLY in React state: a refresh or closed
// tab silently destroyed a running session, and elapsed time was a ticking
// counter (setInterval +1) that drifted and vanished on reload.
//
// The fix extracts the timer logic into client/src/lib/timer.js — a plain
// ES module with injectable storage (localStorage in the app, a Map fake
// here) — and the widget persists the START TIMESTAMP per workspace,
// computes elapsed from Date.now(), enforces ONE active timer (a single
// storage slot), and offers resume-or-discard on load.
//
// The client has no test framework; server tests import the plain (non-JSX)
// module directly (established pattern).
import * as timer from "../client/src/lib/timer.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Fake storage with the localStorage surface (getItem/setItem/removeItem).
const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    slots: () => m.size,
  };
};

const T0 = Date.parse("2026-11-11T10:00:00.000Z");
const at = (ms) => T0 + ms;

console.log("— Load: empty / garbage storage offers nothing —");
{
  const s = fakeStorage();
  ok("empty storage → no active timer", timer.loadTimer(s) === null);

  const s2 = fakeStorage();
  s2.setItem(timer.STORAGE_KEY, "not json at all");
  ok("corrupt JSON → no active timer", timer.loadTimer(s2) === null);

  const s3 = fakeStorage();
  s3.setItem(timer.STORAGE_KEY, JSON.stringify({ wsId: 1 }));
  ok("shapeless payload → no active timer", timer.loadTimer(s3) === null);
}

console.log("— Start: persists the start TIMESTAMP (not a ticking counter) —");
{
  const s = fakeStorage();
  const t = timer.startTimer({ wsId: 7, wsName: "Acme Co", desc: "Inbox zero" }, at(0));
  ok("startedAt is the wall-clock start timestamp (ISO)", t.startedAt === "2026-11-11T10:00:00.000Z");
  ok("fresh session has zero accumulated seconds and is running", t.accumulated === 0 && t.running === true);
  ok("attribution pinned to the starting workspace", t.wsId === 7 && t.wsName === "Acme Co");

  timer.saveTimer(s, t);
  const stored = JSON.parse(s.getItem(timer.STORAGE_KEY));
  ok("persisted payload holds timestamps, no elapsed counter field",
    !("elapsed" in stored || "seconds" in stored || "ticks" in stored));
  ok("persisted payload round-trips through loadTimer", eq(timer.loadTimer(s), t));
}

console.log("— Elapsed: computed from Date.now(), never incremented locally —");
{
  const t = timer.startTimer({ wsId: 7, wsName: "Acme Co" }, at(0));
  ok("65s after start → 65", timer.elapsedSeconds(t, at(65_000)) === 65);
  ok("different now → different elapsed (clock-derived)",
    timer.elapsedSeconds(t, at(65_000)) !== timer.elapsedSeconds(t, at(66_000)));
  ok("elapsed is floored seconds, not ms drift", timer.elapsedSeconds(t, at(65_999)) === 65);
  ok("clock before segment start clamps to 0", timer.elapsedSeconds(t, at(-5000)) === 0);
}

console.log("— One active timer: a single storage slot —");
{
  const s = fakeStorage();
  timer.saveTimer(s, timer.startTimer({ wsId: 1, wsName: "A" }, at(0)));
  timer.saveTimer(s, timer.startTimer({ wsId: 2, wsName: "B" }, at(1000)));
  ok("second start REPLACES, storage still holds one slot", s.slots() === 1);
  ok("the active timer is the newest one", timer.loadTimer(s)?.wsId === 2);
}

console.log("— Pause / resume: accumulated seconds + wall-clock segment —");
{
  const s = fakeStorage();
  let t = timer.startTimer({ wsId: 7, wsName: "Acme Co" }, at(0));
  t = timer.pauseTimer(t, at(10_000));
  ok("pause freezes accumulated seconds", t.running === false && timer.elapsedSeconds(t, at(999_000)) === 10);
  timer.saveTimer(s, t);

  const reloaded = timer.loadTimer(s);
  ok("paused state survives reload (still frozen at 10)",
    reloaded.running === false && timer.elapsedSeconds(reloaded, at(999_000)) === 10);

  t = timer.resumeTimer(reloaded, at(1_000_000));
  ok("resume keeps the ORIGINAL startedAt (session attribution)", t.startedAt === "2026-11-11T10:00:00.000Z");
  ok("resume counts only wall time since the segment start (10 + 65)",
    timer.elapsedSeconds(t, at(1_065_000)) === 75);
}

console.log("— Resume-or-discard on load —");
{
  const s = fakeStorage();
  const t = timer.startTimer({ wsId: 7, wsName: "Acme Co", desc: "Inbox zero" }, at(0));
  timer.saveTimer(s, t);

  // Simulated refresh: the same storage is read back on load.
  const found = timer.loadTimer(s);
  ok("persisted session is found on load (offer prompt can render)", found !== null && found.desc === "Inbox zero");

  const resumed = timer.resumeTimer(found, at(30_000));
  ok("resume path keeps identity + desc", resumed.wsId === 7 && resumed.desc === "Inbox zero");

  timer.discardTimer(s);
  ok("discard path clears the slot → nothing offered again", timer.loadTimer(s) === null && s.slots() === 0);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
