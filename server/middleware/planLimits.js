import db from "../db.js";

// Re-exported for callers that import the constant alongside the middleware
// (workspace.routes.js uses it for the PATCH downgrade-bypass guard).
export { MAX_FREE_WORKSPACES } from "./planLimitsMeta.js";
import { MAX_FREE_WORKSPACES } from "./planLimitsMeta.js";

/**
 * Free tier hard cap: a user may own at most 2 workspaces while their
 * slots are consumed by free workspaces. Upgrading a workspace to
 * 'premium' releases a free slot (Trello-style plan semantics).
 */
export default async function planLimits(req, res, next) {
  const newPlan = req.body?.plan_type === "premium" ? "premium" : "free";
  if (newPlan === "premium") return next(); // premium creation unrestricted in v1

  const { free: freeUsed } = await db
    .prepare(
      `SELECT COUNT(*) AS free
       FROM client_workspaces WHERE owner_id = ? AND plan_type = 'free'`
    )
    .get(req.user.id);

  const used = freeUsed ?? 0;
  if (used >= MAX_FREE_WORKSPACES) {
    return res.status(402).json({
      error: `Free plan is limited to ${MAX_FREE_WORKSPACES} workspaces (${used}/${MAX_FREE_WORKSPACES} used). Upgrade a workspace to premium to free up a slot.`,
      code: "WORKSPACE_LIMIT",
      limit: MAX_FREE_WORKSPACES,
      used,
    });
  }

  next();
}
