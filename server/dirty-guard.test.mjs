// Phase 2.3 — SOP editor dirty-state guard (framework-free module tests).
//
// The editor previously let every exit path silently destroy unsaved work:
// "Back to vault" reset the draft with no question, sidebar navigation
// unmounted the page, and closing the tab lost everything.
//
// The fix extracts the guard logic into client/src/lib/dirtyGuard.js — a
// plain ES module (no React) — and wires it into SopsPage:
//   - hasChanges(): dirty detection (draft vs the baseline snapshot taken
//     when the editor opened)
//   - beforeUnloadGuard(): spec-correct beforeunload handling for tab close
// In-app navigation is intercepted with useBlocker (main.jsx becomes a data
// router) and confirmed with the existing ConfirmModal component.
import * as guard from "../client/src/lib/dirtyGuard.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const BASELINE = { title: "Brand Voice", category: "voice-tone", content: "Be concise." };

console.log("— Dirty detection: draft vs baseline —");
ok("untouched draft → not dirty", guard.hasChanges({ ...BASELINE }, BASELINE) === false);
ok("title change → dirty", guard.hasChanges({ ...BASELINE, title: "Brand Voice v2" }, BASELINE) === true);
ok("category change → dirty", guard.hasChanges({ ...BASELINE, category: "general" }, BASELINE) === true);
ok("content change → dirty", guard.hasChanges({ ...BASELINE, content: "Be clear." }, BASELINE) === true);
ok("no baseline (editor closed) → never dirty", guard.hasChanges(BASELINE, null) === false);
ok("missing draft → not dirty", guard.hasChanges(null, BASELINE) === false);

console.log("— beforeunload: dialog fires ONLY with unsaved changes —");
{
  const dirtyEvent = {
    preventDefaultCount: 0,
    returnValue: undefined,
    preventDefault() { this.preventDefaultCount++; },
  };
  guard.beforeUnloadGuard(dirtyEvent, true);
  ok("dirty → preventDefault called (spec requirement)", dirtyEvent.preventDefaultCount === 1);
  ok("dirty → returnValue set (dialog trigger)", dirtyEvent.returnValue === guard.UNLOAD_MESSAGE);

  const cleanEvent = {
    preventDefaultCount: 0,
    returnValue: undefined,
    preventDefault() { this.preventDefaultCount++; },
  };
  guard.beforeUnloadGuard(cleanEvent, false);
  ok("clean → event untouched (no dialog)", cleanEvent.preventDefaultCount === 0 && cleanEvent.returnValue === undefined);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
