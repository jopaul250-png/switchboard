// Shared plan-limit constants (kept separate so routes importing the
// middleware don't need to reach into the middleware module).
//
// Phase 2.4: ONE account-wide workspace cap. plan_type is not client-settable
// (no billing integration), so the old free/premium slot split is gone.
// Configurable via the WORKSPACE_CAP env var; default 10.
const parsed = Number(process.env.WORKSPACE_CAP);
export const WORKSPACE_CAP = Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
