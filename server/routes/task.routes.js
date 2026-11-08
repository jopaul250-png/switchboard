import { Router } from "express";
import db from "../db.js";

const router = Router();

/**
 * P2 accounting model:
 *  - ACTUALS come only from time_logs (trust-based tracking) — the single
 *    source of truth for tracked hours.
 *  - Task estimated_hours are FORECASTING only and never touch the meter.
 *  - Manual adjustments live in client_workspaces.hours_manual, kept separate.
 *  hours_used (what the Scope Meter renders) = manual + tracked.
 */
export async function scopeSummary(workspaceId) {
  const w = await db
    .prepare("SELECT contract_hours, hours_manual FROM client_workspaces WHERE id = ?")
    .get(workspaceId);
  const tracked = await db
    .prepare("SELECT COALESCE(SUM(duration_seconds), 0) AS t FROM time_logs WHERE workspace_id = ?")
    .get(workspaceId);
  const tracked_hours = Number(tracked.t) / 3600;
  const manual_hours = w.hours_manual || 0;
  return {
    hours_used: manual_hours + tracked_hours,
    tracked_hours,
    manual_hours,
    contract_hours: w.contract_hours,
  };
}

// All routes expect req.workspace

/** GET /workspaces/:id/tasks?status= */
router.get("/", async (req, res) => {
  const { status } = req.query;
  let rows;
  if (status && ["todo", "in_progress", "done"].includes(status)) {
    rows = await db
      .prepare("SELECT * FROM task_lists WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC")
      .all(req.workspace.id, status);
  } else {
    rows = await db
      .prepare("SELECT * FROM task_lists WHERE workspace_id = ? ORDER BY created_at DESC")
      .all(req.workspace.id);
  }
  res.json({ tasks: rows, scope: await scopeSummary(req.workspace.id) });
});

/** POST /workspaces/:id/tasks */
router.post("/", async (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "Task title is required" });

  const status = ["todo", "in_progress", "done"].includes(req.body?.status)
    ? req.body.status
    : "todo";
  const hours = Number(req.body?.estimated_hours);
  const estimatedHours = Number.isFinite(hours) && hours >= 0 ? hours : 1;

  // Note: even when created directly as done, estimated hours are forecast —
  // the Scope Meter only counts actual tracked time (P2 model).
  const { lastID } = await db
    .prepare(
      "INSERT INTO task_lists (workspace_id, title, status, estimated_hours, assigned_to) VALUES (?, ?, ?, ?, ?) RETURNING id"
    )
    .run(req.workspace.id, title, status, estimatedHours, req.body?.assigned_to ?? null);

  const task = await db.prepare("SELECT * FROM task_lists WHERE id = ?").get(lastID);
  res.status(201).json({ task, scope: await scopeSummary(req.workspace.id) });
});

/**
 * PATCH /workspaces/:id/tasks/:taskId
 * P2: status transitions never mutate the Scope Meter — estimated hours are
 * forecasting only. Actuals are owned exclusively by time_logs / manual adjust.
 * Response still carries the fresh scope summary for instant UI updates.
 */
router.patch("/:taskId", async (req, res) => {
  const row = await db
    .prepare("SELECT * FROM task_lists WHERE id = ? AND workspace_id = ?")
    .get(Number(req.params.taskId), req.workspace.id);
  if (!row) return res.status(404).json({ error: "Task not found" });

  const status = req.body?.status;
  if (status === undefined && req.body?.assigned_to === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  if (status !== undefined && !["todo", "in_progress", "done"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  await db.tx(async () => {
    if (status !== undefined) {
      await db.prepare("UPDATE task_lists SET status = ? WHERE id = ?").run(status, row.id);
    }
    if (req.body?.assigned_to !== undefined) {
      await db.prepare("UPDATE task_lists SET assigned_to = ? WHERE id = ?").run(
        req.body.assigned_to,
        row.id
      );
    }
  });

  const task = await db.prepare("SELECT * FROM task_lists WHERE id = ?").get(row.id);
  res.json({ task, scope: await scopeSummary(req.workspace.id) });
});

/** DELETE /workspaces/:id/tasks/:taskId — P2: no meter mutation (estimates ≠ actuals) */
router.delete("/:taskId", async (req, res) => {
  const row = await db
    .prepare("SELECT * FROM task_lists WHERE id = ? AND workspace_id = ?")
    .get(Number(req.params.taskId), req.workspace.id);
  if (!row) return res.status(404).json({ error: "Task not found" });

  await db.prepare("DELETE FROM task_lists WHERE id = ?").run(row.id);

  res.status(204).end();
});

export default router;
