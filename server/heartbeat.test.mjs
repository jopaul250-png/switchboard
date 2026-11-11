// Phase 2.6 — stopwatch trust fix: last-active heartbeat + long-gap choices.
//
// The 2.2 persistence credits wall time while the tab was CLOSED (elapsed is
// computed from Date.now()). That can silently credit hours the user did not
// work. The trust fix:
//
//   1. While the page is open and the clock runs, a HEARTBEAT keeps the
//      persisted `lastActive` timestamp fresh (every 30s, plus on tab-hide).
//   2. On load — or when the tab becomes visible again — a gap longer than
//      LONG_GAP_MS since lastActive is a LONG GAP: the widget must offer
//        a) Log until last active   (credit nothing after lastActive)
//        b) Resume, crediting the gap
//        c) Edit the duration, then continue
//        d) Discard the session
//   A long gap is NEVER silently credited.
//
// Fail-before: none of these exports exist in lib/timer.js yet (the checks
// below fail with undefined), reproducing the 2.2 behavior that credited the
// whole closed-tab gap as soon as the user pressed Resume.
import * as timer from "../client/src/lib/timer.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const T0 = Date.parse("2026-11-11T10:00:00.000Z");
const at = (ms) => T0 + ms;

console.log("— Heartbeat constants and start shape —");
ok("HEARTBEAT_MS exists and is positive", Number.isFinite(timer.HEARTBEAT_MS) && timer.HEARTBEAT_MS > 0);
ok("LONG_GAP_MS exists and exceeds the heartbeat window",
  Number.isFinite(timer.LONG_GAP_MS) && timer.LONG_GAP_MS > timer.HEARTBEAT_MS);
{
  const t = timer.startTimer({ wsId: 7, wsName: "Acme Co" }, at(0));
  ok("started sessions carry a lastActive timestamp", t.lastActive === "2026-11-11T10:00:00.000Z");
}

console.log("— beatTimer refreshes ONLY lastActive —");
{
  const t = timer.startTimer({ wsId: 7, wsName: "Acme Co", desc: "Inbox" }, at(0));
  const beaten = timer.beatTimer(t, at(30_000));
  ok("lastActive advanced to now", beaten.lastActive === "2026-11-11T10:00:30.000Z");
  const { lastActive, ...rest } = beaten;
  const { lastActive: _old, ...restOld } = t;
  ok("nothing else changed", eq(rest, restOld));
}

console.log("— Gap detection —");
{
  const t = timer.startTimer({ wsId: 7, wsName: "Acme Co" }, at(0));
  const beaten = timer.beatTimer(t, at(30_000));
  ok("gap of 60s (within threshold) is not long", timer.hasLongGap(beaten, at(90_000)) === false);
  ok("gap of 2 minutes is long", timer.hasLongGap(beaten, at(150_000)) === true);
  ok("gapSeconds returns the gap in whole seconds", timer.gapSeconds(beaten, at(150_000)) === 120);
  const paused = timer.pauseTimer(beaten, at(35_000));
  ok("paused sessions never report a long gap", timer.hasLongGap(paused, at(150_000)) === false);
  ok("sessions without lastActive never report a long gap",
    timer.hasLongGap({ ...t, lastActive: undefined }, at(150_000)) === false);
}

console.log("— elapsedUntilLastActive excludes everything after the heartbeat —");
{
  const t = timer.startTimer({ wsId: 7, wsName: "Acme Co" }, at(0));
  const beaten = timer.beatTimer(t, at(30_000)); // last active 30s in
  ok("credits 30s (until last active)", timer.elapsedUntilLastActive(beaten, at(150_000)) === 30);
  ok("does NOT grow with the closed-tab gap", timer.elapsedUntilLastActive(beaten, at(999_000)) === 30);
  const paused = timer.pauseTimer(beaten, at(35_000));
  ok("paused: frozen accumulated seconds", timer.elapsedUntilLastActive(paused, at(999_000)) === 35);
}

console.log("— Credit-the-gap is an explicit choice —");
{
  const t = timer.startTimer({ wsId: 7, wsName: "Acme Co" }, at(0));
  const beaten = timer.beatTimer(t, at(30_000));
  const credited = timer.creditGap(beaten, at(150_000));
  ok("banked 150s (30 worked + 120 gap) — only when chosen", credited.accumulated === 150);
  ok("still running, segment re-anchored to now", credited.running === true);
  ok("keeps the original startedAt (session attribution)", credited.startedAt === "2026-11-11T10:00:00.000Z");
  ok("clock continues from the credited amount", timer.elapsedSeconds(credited, at(160_000)) === 160);
}

console.log("— Edit-duration applies an exact amount and continues —");
{
  const t = timer.startTimer({ wsId: 7, wsName: "Acme Co" }, at(0));
  const edited = timer.applyDuration(t, 20 * 60, at(150_000)); // user says: 20 minutes
  ok("accumulated set to the edited amount", timer.elapsedSeconds(edited, at(150_000)) === 1200);
  ok("keeps the original startedAt", edited.startedAt === "2026-11-11T10:00:00.000Z");
  ok("running from now with a fresh segment", edited.running === true && edited.segmentStart === "2026-11-11T10:02:30.000Z");
  ok("clock continues from the edited amount", timer.elapsedSeconds(edited, at(180_000)) === 1230);
}

console.log("— Backward compatibility: 2.2-era persisted shapes still load —");
{
  const s = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const legacy = {
    wsId: 7, wsName: "Acme Co", desc: "",
    startedAt: "2026-11-11T10:00:00.000Z",
    segmentStart: "2026-11-11T10:00:00.000Z",
    accumulated: 0,
    running: true,
  };
  const store = {
    getItem: (k) => (k === timer.STORAGE_KEY ? JSON.stringify(legacy) : null),
    setItem: () => {}, removeItem: () => {},
  };
  ok("shape WITHOUT lastActive (pre-2.6) still loads", timer.loadTimer(store) !== null);
  const bad = { ...legacy, lastActive: "not-a-date" };
  const store2 = {
    getItem: (k) => (k === timer.STORAGE_KEY ? JSON.stringify(bad) : null),
    setItem: () => {}, removeItem: () => {},
  };
  ok("corrupt lastActive → rejected", timer.loadTimer(store2) === null);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
