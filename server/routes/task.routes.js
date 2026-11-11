import { Router } from "express";
import db from "../db.js";
import { strField, numField, enumField } from "../lib/validate.js";

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

/**
 * Phase 1.4: assigned_to pre-validation. task_lists.assigned_to is an
 * INTEGER FK to users(id); checking here turns a mid-transaction FK
 * violation (500 + rollback) into a deterministic 400 before any write.
 * Returns { value: userId|null } or { error }.
 */
async function resolveAssignedTo(raw) {
  if (raw === undefined || raw === null || raw === "") return { value: null };
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return { error: "assigned_to must be a valid user id" };
  const user = await db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!user) return { error: "Assigned user does not exist" };
  return { value: id };
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
  // Phase 1.4: title cap consistent with SOPs
  if (strField(title, { name: "Task title", max: 200 }).error)
    return res.status(400).json({ error: "Task title too long (max 200 chars)" });

  const statusV = enumField(req.body?.status, ["todo", "in_progress", "done"], { name: "status", fallback: "todo" });
  if (statusV.error) return res.status(400).json({ error: statusV.error });
  const status = statusV.value;

  // Phase 1.4: forecasts capped at 0–1000 (missing → default 1)
  const hoursV = numField(req.body?.estimated_hours, {
    name: "estimated_hours", min: 0, max: 1000, fallback: 1,
  });
  if (hoursV.error) return res.status(400).json({ error: hoursV.error });
  const estimatedHours = hoursV.value;

  // Phase 1.4: pre-validate the assignee exists (clean 400, not a 500 rollback)
  const assignedToV = await resolveAssignedTo(req.body?.assigned_to);
  if (assignedToV.error) return res.status(400).json({ error: assignedToV.error });

  // Note: even when created directly as done, estimated hours are forecast —
  // the Scope Meter only counts actual tracked time (P2 model).
  const { lastID } = await db
    .prepare(
      "INSERT INTO task_lists (workspace_id, title, status, estimated_hours, assigned_to) VALUES (?, ?, ?, ?, ?) RETURNING id"
    )
    .run(req.workspace.id, title, status, estimatedHours, assignedToV.value);

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

  // Phase 1.4: pre-validate the assignee exists BEFORE the tx — a bad
  // assigned_to is now a deterministic 400 instead of a mid-transaction
  // FK violation (500 + rollback). Status stays untouched either way.
  const assignedToV = await resolveAssignedTo(req.body?.assigned_to);
  if (assignedToV.error) return res.status(400).json({ error: assignedToV.error });

  try {
    await db.tx(async (txDb) => {
      if (status !== undefined) {
        await txDb.prepare("UPDATE task_lists SET status = ? WHERE id = ?").run(status, row.id);
      }
      if (req.body?.assigned_to !== undefined) {
        await txDb.prepare("UPDATE task_lists SET assigned_to = ? WHERE id = ?").run(
          assignedToV.value,
          row.id
        );
      }
    });
  } catch (err) {
    // e.g. FK violation on assigned_to — the failed tx rolls back and
    // NOTHING is updated. Catches propagate to a deterministic 500 (Express
    // 4 does not handle async handler rejections on its own).
    console.error("[switchboard] task update tx failed:", err.message);
    return res.status(500).json({ error: "Task update failed" });
  }

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
