import { Router } from "express";
import db from "../db.js";
import { scopeSummary } from "./task.routes.js";
import { strField, dateField } from "../lib/validate.js";

const router = Router();

/** GET / — raw logs + total tracked seconds for this workspace */
router.get("/", async (req, res) => {
  const logs = await db
    .prepare("SELECT * FROM time_logs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT 100")
    .all(req.workspace.id);
  const total = await db
    .prepare("SELECT COALESCE(SUM(duration_seconds), 0) AS t FROM time_logs WHERE workspace_id = ?")
    .get(req.workspace.id);
  res.json({ logs, total_seconds: Number(total.t) });
});

/**
 * POST / — the "Stop" action.
 * Saves the raw session record; the Scope Meter derives from time_logs, so
 * inserting the raw log IS the increment onto the meter (P2 actuals model).
 * Returns the fresh scope summary so the dashboard updates without a refresh.
 */
router.post("/", async (req, res) => {
  const seconds = Math.round(Number(req.body?.duration_seconds));
  if (!Number.isFinite(seconds) || seconds < 1) {
    return res.status(400).json({ error: "duration_seconds must be at least 1" });
  }
  if (seconds > 24 * 3600) {
    return res.status(400).json({ error: "Max 24h per logged session" });
  }
  const description = String(req.body?.task_description || "").trim() || "Tracked session";
  // Phase 1.4: description cap + started_at must be ISO-parseable
  const descriptionV = strField(description, { name: "task_description", max: 500, required: true });
  if (descriptionV.error) return res.status(400).json({ error: descriptionV.error });

  const startedAtV = dateField(req.body?.started_at, { name: "started_at" });
  if (startedAtV.error) return res.status(400).json({ error: startedAtV.error });
  const startedAt = startedAtV.value ?? new Date().toISOString();

  const { lastID } = await db
    .prepare(
      "INSERT INTO time_logs (workspace_id, task_description, duration_seconds, started_at) VALUES (?, ?, ?, ?) RETURNING id"
    )
    .run(req.workspace.id, description, seconds, startedAt);

  const log = await db.prepare("SELECT * FROM time_logs WHERE id = ?").get(lastID);
  res.status(201).json({ log, scope: await scopeSummary(req.workspace.id) });
});

/**
 * DELETE /:logId — mistake-fix: deleting a log removes the actual time it
 * contributed (derived real-time re-computation keeps the meter honest).
 * Returns the fresh scope so the frontend meter updates without a refresh.
 */
router.delete("/:logId", async (req, res) => {
  const row = await db
    .prepare("SELECT * FROM time_logs WHERE id = ? AND workspace_id = ?")
    .get(Number(req.params.logId), req.workspace.id);
  if (!row) return res.status(404).json({ error: "Time log not found" });

  await db.prepare("DELETE FROM time_logs WHERE id = ?").run(row.id);

  res.json({ scope: await scopeSummary(req.workspace.id) });
});

export default router;
