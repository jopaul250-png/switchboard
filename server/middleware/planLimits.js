import db from "../db.js";

// Re-exported for callers that import the constant alongside the middleware.
export { WORKSPACE_CAP } from "./planLimitsMeta.js";
import { WORKSPACE_CAP } from "./planLimitsMeta.js";

/**
 * Phase 2.4: ONE account-wide cap. A user may own at most WORKSPACE_CAP
 * workspaces, counted across ALL owned workspaces — plan_type is not
 * client-settable and no longer affects the cap (there is no billing
 * integration, so the old free/premium slot split is gone).
 *
 * Applies to POST /workspaces. Client-sent plan_type is ignored upstream:
 * POST always creates 'free' and PATCH never touches plan_type.
 */
export default async function planLimits(req, res, next) {
  const row = await db
    .prepare("SELECT COUNT(*) AS used FROM client_workspaces WHERE owner_id = ?")
    .get(req.user.id);
  const used = Number(row?.used ?? 0);
  if (used >= WORKSPACE_CAP) {
    return res.status(402).json({
      error: `Your plan is limited to ${WORKSPACE_CAP} workspaces (${used}/${WORKSPACE_CAP} used).`,
      code: "WORKSPACE_LIMIT",
      limit: WORKSPACE_CAP,
      used,
    });
  }
  next();
}
