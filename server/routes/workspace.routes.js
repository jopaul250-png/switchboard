import { Router } from "express";
import db, { seedPulseQueues } from "../db.js";
import planLimits from "../middleware/planLimits.js";
import workspaceScope from "../middleware/workspaceScope.js";
import { scopeSummary } from "./task.routes.js";

const router = Router();

/** GET / — owned list + unread pulse totals (sidebar badges) */
router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `SELECT w.*,
              w.hours_manual + COALESCE((SELECT SUM(duration_seconds) FROM time_logs tl WHERE tl.workspace_id = w.id), 0) / 3600.0
                AS hours_used,
              COALESCE((SELECT SUM(unread_count) FROM pulse_feeds pf WHERE pf.workspace_id = w.id), 0)
                AS pulse_unread,
              (SELECT COUNT(*) FROM task_lists t WHERE t.workspace_id = w.id AND t.status != 'done')
                AS open_tasks
       FROM client_workspaces w
       WHERE w.owner_id = ?
       ORDER BY w.created_at ASC`
    )
    .all(req.user.id);
  res.json({ workspaces: rows });
});

/** POST / — free-tier cap enforced here */
router.post("/", planLimits, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Workspace name is required" });
  if (name.length > 60) return res.status(400).json({ error: "Name too long (max 60 chars)" });

  const plan = req.body?.plan_type === "premium" ? "premium" : "free";
  const contractHours = Number.isFinite(Number(req.body?.contract_hours))
    ? Math.max(0, Number(req.body.contract_hours))
    : 40;

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        "INSERT INTO client_workspaces (name, owner_id, plan_type, contract_hours) VALUES (?, ?, ?, ?)"
      )
      .run(name, req.user.id, plan, contractHours);
    const id = info.lastInsertRowid;
    seedPulseQueues(id);
    return db.prepare("SELECT * FROM client_workspaces WHERE id = ?").get(id);
  });

  res.status(201).json({ workspace: tx() });
});

/** GET /:workspaceId — detail incl. derived scope summary */
router.get("/:workspaceId", workspaceScope, (req, res) => {
  const scope = scopeSummary(req.workspace.id);
  const unread = db
    .prepare("SELECT COALESCE(SUM(unread_count), 0) AS t FROM pulse_feeds WHERE workspace_id = ?")
    .get(req.workspace.id).t;
  // hours_used exposed to the client is always the derived meter value
  res.json({
    workspace: { ...req.workspace, hours_used: scope.hours_used, pulse_unread: unread },
    scope,
  });
});

/** PATCH /workspaces/:id — rename / billing switch / scope guardrail inputs */
router.patch("/:workspaceId", workspaceScope, (req, res) => {
  const w = req.workspace;
  const updates = {};
  const errors = [];

  if ("name" in req.body) {
    const name = String(req.body.name || "").trim();
    if (!name) errors.push("Name cannot be empty");
    else updates.name = name;
  }
  if ("plan_type" in req.body) {
    if (!["free", "premium"].includes(req.body.plan_type)) errors.push("Invalid plan_type");
    else updates.plan_type = req.body.plan_type;
  }
  if ("contract_hours" in req.body) {
    const n = Number(req.body.contract_hours);
    if (!Number.isFinite(n) || n < 0) errors.push("contract_hours must be a positive number");
    else updates.contract_hours = n;
  }
  if ("hours_manual" in req.body) {
    // P2: manual adjustments are recorded separately from tracked actuals
    const n = Number(req.body.hours_manual);
    if (!Number.isFinite(n) || n < 0) errors.push("hours_manual must be a positive number");
    else updates.hours_manual = n;
  }
  // legacy: accept hours_used as a manual adjustment value for old clients
  if ("hours_used" in req.body) {
    const n = Number(req.body.hours_used);
    if (!Number.isFinite(n) || n < 0) errors.push("hours_used must be a positive number");
    else updates.hours_manual = n;
  }
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });
  if (!Object.keys(updates).length) return res.status(400).json({ error: "Nothing to update" });

  const setSql = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE client_workspaces SET ${setSql} WHERE id = ?`).run(
    ...Object.values(updates),
    w.id
  );

  const fresh = db.prepare("SELECT * FROM client_workspaces WHERE id = ?").get(w.id);
  const scope = scopeSummary(w.id);
  res.json({ workspace: { ...fresh, hours_used: scope.hours_used }, scope });
});

/** DELETE /workspaces/:id — cascades children */
router.delete("/:workspaceId", workspaceScope, (req, res) => {
  db.prepare("DELETE FROM client_workspaces WHERE id = ?").run(req.workspace.id);
  res.status(204).end();
});

export default router;
