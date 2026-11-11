// Phase 2.5 — active-workspace switch guard for the SOP editor.
//
// The 2.3 guard covers in-app ROUTE navigation and tab close. Switching the
// ACTIVE WORKSPACE in the sidebar is a context change the router cannot see:
// SopsPage's reset effect silently destroyed a dirty draft on every switch.
//
// The fix routes every workspace switch through one pure decision function
// (client/src/lib/switchGuard.js) that returns the action to take:
//   "confirm"  — editor holds a dirty draft: keep it, show the confirm
//                dialog, change nothing until the user answers
//   "reset"    — original behavior (not editing, or a clean draft)
//   "restore"  — the user chose "keep editing": we are switching BACK to the
//                previous workspace — skip both guard and reset silently
//   "noop"     — same id / no target
//
// Fail-before: this module does not exist yet (the reset effect acted
// unconditionally, discarding dirty drafts).
import { planWorkspaceSwitch } from "../client/src/lib/switchGuard.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log("— Original behavior is preserved for clean switches —");
ok("not editing → reset as before", planWorkspaceSwitch({ editing: false, dirty: false, reverting: false, from: 1, to: 2 }).action === "reset");
ok("editing with a clean draft → reset as before", planWorkspaceSwitch({ editing: true, dirty: false, reverting: false, from: 1, to: 2 }).action === "reset");

console.log("— Dirty draft while editing → confirm dialog, nothing reset —");
ok("dirty draft → confirm", planWorkspaceSwitch({ editing: true, dirty: true, reverting: false, from: 1, to: 2 }).action === "confirm");

console.log("— 'Keep editing' restores the previous workspace WITHOUT re-prompting —");
ok("reverting → restore (no guard, no reset)", planWorkspaceSwitch({ editing: true, dirty: true, reverting: true, from: 2, to: 1 }).action === "restore");

console.log("— Degenerate switches do nothing —");
ok("same id → noop", planWorkspaceSwitch({ editing: true, dirty: true, reverting: false, from: 1, to: 1 }).action === "noop");
ok("no target → noop", planWorkspaceSwitch({ editing: true, dirty: true, reverting: false, from: 1, to: null }).action === "noop");

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
