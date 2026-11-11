// Phase 2.5 — active-workspace switch decision for the SOP editor
// (framework-free; server tests import this module directly — same pattern
// as lib/timer.js and lib/dirtyGuard.js).
//
// The 2.3 guard covers in-app ROUTE navigation and tab close. Switching the
// ACTIVE WORKSPACE in the sidebar is a context change the router cannot
// see, so SopsPage routes every switch through this single decision:
//
//   "confirm"  — the editor holds a dirty draft: change nothing, keep the
//                draft on screen, and let the page show its confirm dialog.
//                ("Discard & Switch" clears the draft; "Cancel" restores the
//                previous workspace.)
//   "reset"    — original behavior: not editing, or a clean draft — reset
//                the editor and load the new workspace's SOPs.
//   "restore"  — the user chose to keep editing: the page is switching BACK
//                to the previous workspace — skip both guard and reset.
//   "noop"     — same id, or nothing to switch to.

export function planWorkspaceSwitch({ editing, dirty, reverting, from, to }) {
  if (reverting) return { action: "restore" };
  if (from === to || !to) return { action: "noop" };
  if (editing && dirty) return { action: "confirm" };
  return { action: "reset" };
}
