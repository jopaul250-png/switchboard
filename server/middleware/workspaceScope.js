import db from "../db.js";

/**
 * Ensures :workspaceId belongs to req.user. Attaches req.workspace.
 * 404 (not 403) so we never leak workspace existence.
 */
export default function workspaceScope(req, res, next) {
  const id = Number(req.params.workspaceId);
  if (!id || Number.isNaN(id)) return res.status(400).json({ error: "Invalid workspace id" });

  const ws = db
    .prepare("SELECT * FROM client_workspaces WHERE id = ? AND owner_id = ?")
    .get(id, req.user.id);

  if (!ws) return res.status(404).json({ error: "Workspace not found" });
  req.workspace = ws;
  next();
}
