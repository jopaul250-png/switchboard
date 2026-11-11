import { Router } from "express";
import db, { seedPulseQueues } from "../db.js";
import planLimits, { MAX_FREE_WORKSPACES } from "../middleware/planLimits.js";
import workspaceScope from "../middleware/workspaceScope.js";
import { scopeSummary } from "./task.routes.js";
import { strField, numField } from "../lib/validate.js";

const router = Router();

/** GET / — owned list + unread pulse totals (sidebar badges) */
router.get("/", async (req, res) => {
  const rows = await db
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
  // Postgres returns bigint aggregates (SUM/COUNT) as strings; normalize so
  // the frontend (and tests) always see numbers. SQLite is unaffected.
  const workspaces = rows.map((w) => ({
    ...w,
    hours_used: Number(w.hours_used ?? 0),
    pulse_unread: Number(w.pulse_unread ?? 0),
    open_tasks: Number(w.open_tasks ?? 0),
  }));
  res.json({ workspaces });
});

/** POST / — free-tier cap enforced here */
router.post("/", planLimits, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Workspace name is required" });
  if (name.length > 60) return res.status(400).json({ error: "Name too long (max 60 chars)" });

  const plan = req.body?.plan_type === "premium" ? "premium" : "free";
  // Phase 1.4: explicit 0–10000 bounds (previously silently defaulted on garbage)
  const contractHoursV = numField(req.body?.contract_hours, {
    name: "contract_hours", min: 0, max: 10000, fallback: 40,
  });
  if (contractHoursV.error) return res.status(400).json({ error: contractHoursV.error });
  const contractHours = contractHoursV.value;

  // Test-only injection hook: a mid-transaction failure AFTER the INSERT.
  // Requires ALL of: the server to run with SWITCHBOARD_ALLOW_TX_INJECTION=1,
  // the request to carry the header, and a non-production NODE_ENV — the hook
  // is UNREACHABLE in production regardless of env/header (tested by
  // injection-guard.test.mjs).
  const injectTxFailure =
    process.env.NODE_ENV !== "production" &&
    process.env.SWITCHBOARD_ALLOW_TX_INJECTION === "1" &&
    req.get("x-switchboard-tx-fail") === "1";

  let workspace;
  try {
    workspace = await db.tx(async (txDb) => {
      const { lastID } = await txDb
        .prepare(
          "INSERT INTO client_workspaces (name, owner_id, plan_type, contract_hours) VALUES (?, ?, ?, ?) RETURNING id"
        )
        .run(name, req.user.id, plan, contractHours);
      await seedPulseQueues(lastID, txDb);
      if (injectTxFailure) throw new Error("Injected mid-transaction failure");
      return txDb.prepare("SELECT * FROM client_workspaces WHERE id = ?").get(lastID);
    });
  } catch (err) {
    console.error("[switchboard] workspace create tx failed:", err.message);
    return res.status(500).json({ error: "Workspace creation failed" });
  }

  res.status(201).json({ workspace });
});

/** GET /:workspaceId — detail incl. derived scope summary */
router.get("/:workspaceId", workspaceScope, async (req, res) => {
  const scope = await scopeSummary(req.workspace.id);
  const unread = await db
    .prepare("SELECT COALESCE(SUM(unread_count), 0) AS t FROM pulse_feeds WHERE workspace_id = ?")
    .get(req.workspace.id);
  // hours_used exposed to the client is always the derived meter value
  res.json({
    workspace: {
      ...req.workspace,
      hours_used: scope.hours_used,
      pulse_unread: Number(unread.t),
    },
    scope,
  });
});

/** PATCH /workspaces/:id — rename / billing switch / scope guardrail inputs */
router.patch("/:workspaceId", workspaceScope, async (req, res) => {
  const w = req.workspace;
  const updates = {};
  const errors = [];

  if ("name" in req.body) {
    // Phase 1.4: PATCH enforces the same 60-char cap as POST
    const nameV = strField(req.body.name, { name: "Name", max: 60, required: true });
    if (nameV.error) errors.push(nameV.error);
    else updates.name = nameV.value;
  }
  if ("plan_type" in req.body) {
    if (!["free", "premium"].includes(req.body.plan_type)) errors.push("Invalid plan_type");
    else updates.plan_type = req.body.plan_type;
  }
  if ("contract_hours" in req.body) {
    // Phase 1.4: 0–10000 bounds
    const v = numField(req.body.contract_hours, { name: "contract_hours", min: 0, max: 10000 });
    if (v.error) errors.push(v.error);
    else updates.contract_hours = v.value;
  }
  if ("hours_manual" in req.body) {
    // P2: manual adjustments are recorded separately from tracked actuals
    const v = numField(req.body.hours_manual, { name: "hours_manual", min: 0, max: 10000 });
    if (v.error) errors.push(v.error);
    else updates.hours_manual = v.value;
  }
  // legacy: accept hours_used as a manual adjustment value for old clients
  if ("hours_used" in req.body) {
    const v = numField(req.body.hours_used, { name: "hours_used", min: 0, max: 10000 });
    if (v.error) errors.push(v.error);
    else updates.hours_manual = v.value;
  }
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });
  if (!Object.keys(updates).length) return res.status(400).json({ error: "Nothing to update" });

  // Beta-hardening fix: prevent premium→free downgrade when the 2-free-slot
  // budget is already exhausted (mirrors planLimits on creation).
  if (updates.plan_type === "free" && w.plan_type === "premium") {
    const { free: freeUsed } = await db
      .prepare("SELECT COUNT(*) AS free FROM client_workspaces WHERE owner_id = ? AND plan_type = 'free'")
      .get(w.owner_id);
    if (freeUsed >= MAX_FREE_WORKSPACES) {
      return res.status(402).json({
        error: `Cannot downgrade: Free plan is limited to ${MAX_FREE_WORKSPACES} workspaces (${freeUsed}/${MAX_FREE_WORKSPACES} used).`,
        code: "WORKSPACE_LIMIT",
        limit: MAX_FREE_WORKSPACES,
      });
    }
  }

  const setSql = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  await db
    .prepare(`UPDATE client_workspaces SET ${setSql} WHERE id = ?`)
    .run(...Object.values(updates), w.id);

  const fresh = await db.prepare("SELECT * FROM client_workspaces WHERE id = ?").get(w.id);
  const scope = await scopeSummary(w.id);
  res.json({ workspace: { ...fresh, hours_used: scope.hours_used }, scope });
});

/** DELETE /workspaces/:id — cascades children */
router.delete("/:workspaceId", workspaceScope, async (req, res) => {
  await db.prepare("DELETE FROM client_workspaces WHERE id = ?").run(req.workspace.id);
  res.status(204).end();
});

export default router;
