import db from "../db.js";

export const MAX_FREE_WORKSPACES = 2;

/**
 * Free tier hard cap: a user may own at most 2 workspaces while their
 * slots are consumed by free workspaces. Upgrading a workspace to
 * 'premium' releases a free slot (Trello-style plan semantics).
 */
export default function planLimits(req, res, next) {
  const newPlan = req.body?.plan_type === "premium" ? "premium" : "free";
  if (newPlan === "premium") return next(); // premium creation unrestricted in v1

  const { free: freeUsed, total } = db
    .prepare(
      `SELECT
         SUM(CASE WHEN plan_type = 'free' THEN 1 ELSE 0 END) AS free,
         COUNT(*) AS total
       FROM client_workspaces WHERE owner_id = ?`
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
