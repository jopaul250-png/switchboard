import { Router } from "express";
import db from "../db.js";
import { strField } from "../lib/validate.js";

const router = Router();

// All routes here expect req.workspace (workspaceScope applied at mount)

/** GET / — card list */
router.get("/", async (req, res) => {
  const rows = await db
    .prepare("SELECT * FROM sop_documents WHERE workspace_id = ? ORDER BY updated_at DESC")
    .all(req.workspace.id);
  res.json({ sops: rows });
});

/** POST / */
router.post("/", async (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "Title is required" });

  // Phase 1.4: length caps at the API edge
  const titleV = strField(title, { name: "Title", max: 200 });
  if (titleV.error) return res.status(400).json({ error: titleV.error });

  const content = String(req.body?.content ?? "");
  const contentV = strField(content, { name: "Content", max: 100000 });
  if (contentV.error) return res.status(400).json({ error: contentV.error });

  const category = String(req.body?.category || "general").trim();
  const categoryV = strField(category, { name: "Category", max: 60 });
  if (categoryV.error) return res.status(400).json({ error: categoryV.error });

  const { lastID } = await db
    .prepare(
      "INSERT INTO sop_documents (workspace_id, title, content, category) VALUES (?, ?, ?, ?) RETURNING id"
    )
    .run(req.workspace.id, title, content, category || "general");

  const sop = await db.prepare("SELECT * FROM sop_documents WHERE id = ?").get(lastID);
  res.status(201).json({ sop });
});

/** GET :sopId — detail */
router.get("/:sopId", async (req, res) => {
  const row = await db
    .prepare("SELECT * FROM sop_documents WHERE id = ? AND workspace_id = ?")
    .get(Number(req.params.sopId), req.workspace.id);
  if (!row) return res.status(404).json({ error: "SOP not found" });
  res.json({ sop: row });
});

/** PUT — detail / update */
router.put("/:sopId", async (req, res) => {
  const row = await db
    .prepare("SELECT * FROM sop_documents WHERE id = ? AND workspace_id = ?")
    .get(Number(req.params.sopId), req.workspace.id);
  if (!row) return res.status(404).json({ error: "SOP not found" });

  const title = "title" in req.body ? String(req.body.title).trim() : row.title;
  const content = "content" in req.body ? String(req.body.content) : row.content;
  const category = "category" in req.body ? String(req.body.category).trim() : row.category;
  if (!title) return res.status(400).json({ error: "Title is required" });

  // Phase 1.4: length caps on provided fields (stored fallbacks already valid)
  if ("title" in req.body) {
    const v = strField(title, { name: "Title", max: 200 });
    if (v.error) return res.status(400).json({ error: v.error });
  }
  if ("content" in req.body) {
    const v = strField(content, { name: "Content", max: 100000 });
    if (v.error) return res.status(400).json({ error: v.error });
  }
  if ("category" in req.body) {
    const v = strField(category, { name: "Category", max: 60 });
    if (v.error) return res.status(400).json({ error: v.error });
  }

  // JS-generated ISO timestamp: dialect-agnostic (no SQLite/PG SQL default).
  await db
    .prepare("UPDATE sop_documents SET title = ?, content = ?, category = ?, updated_at = ? WHERE id = ?")
    .run(title, content, category, new Date().toISOString(), row.id);

  res.json({ sop: await db.prepare("SELECT * FROM sop_documents WHERE id = ?").get(row.id) });
});

/** DELETE /:sopId */
router.delete("/:sopId", async (req, res) => {
  const { changes } = await db
    .prepare("DELETE FROM sop_documents WHERE id = ? AND workspace_id = ?")
    .run(Number(req.params.sopId), req.workspace.id);
  if (!changes) return res.status(404).json({ error: "SOP not found" });
  res.status(204).end();
});

export default router;
