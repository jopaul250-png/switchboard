// Phase 2.3 — dirty-state guard logic for the SOP editor (framework-free;
// the client has no test framework, so server tests import this module
// directly — same pattern as lib/timer.js).
//
// Wires the actuals: SopsPage snapshots a BASELINE when the editor opens,
// treats the draft as dirty while it differs, blocks in-app navigation with
// useBlocker + a ConfirmModal, and refuses tab close via beforeunload.

/** Editor fields compared against the baseline snapshot. */
export const FIELDS = ["title", "category", "content"];

/** Generic beforeunload message (browsers render their own wording). */
export const UNLOAD_MESSAGE = "You have unsaved changes to this SOP.";

/** True when the draft differs from the baseline snapshot in any field.
 *  No baseline (editor closed) → never dirty. */
export function hasChanges(draft, baseline) {
  if (!baseline || !draft) return false;
  return FIELDS.some((k) => (draft[k] ?? "") !== (baseline[k] ?? ""));
}

/** beforeunload handler body: with unsaved changes, trigger the browser's
 *  leave dialog (preventDefault per spec + returnValue per Chrome); with a
 *  clean draft, do nothing so the tab closes silently. */
export function beforeUnloadGuard(event, dirty) {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = UNLOAD_MESSAGE;
}
