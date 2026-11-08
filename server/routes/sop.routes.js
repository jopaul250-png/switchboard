import { Router } from "express";
import db from "../db.js";

const router = Router();

// All routes here expect req.workspace (workspaceScope applied at mount)

/** GET / — card list */
router.get("/", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM sop_documents WHERE workspace_id = ? ORDER BY updated_at DESC")
    .all(req.workspace.id);
  res.json({ sops: rows });
});

/** POST / */
router.post("/", (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "Title is required" });

  const content = String(req.body?.content ?? "");
  const category = String(req.body?.category || "general").trim();

  const info = db
    .prepare(
      "INSERT INTO sop_documents (workspace_id, title, content, category) VALUES (?, ?, ?, ?)"
    )
    .run(req.workspace.id, title, content, category || "general");

  const sop = db.prepare("SELECT * FROM sop_documents WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ sop });
});

/** Duplicated GET :sopId comment removed — detail */
router.get("/:sopId", (req, res) => {
  const row = db
    .prepare("SELECT * FROM sop_documents WHERE id = ? AND workspace_id = ?")
    .get(Number(req.params.sopId), req.workspace.id);
  if (!row) return res.status(404).json({ error: "SOP not found" });
  res.json({ sop: row });
});

/** PUT — detail / update */
router.put("/:sopId", (req, res) => {
  const row = db
    .prepare("SELECT * FROM sop_documents WHERE id = ? AND workspace_id = ?")
    .get(Number(req.params.sopId), req.workspace.id);
  if (!row) return res.status(404).json({ error: "SOP not found" });

  const title = "title" in req.body ? String(req.body.title).trim() : row.title;
  const content = "content" in req.body ? String(req.body.content) : row.content;
  const category = "category" in req.body ? String(req.body.category).trim() : row.category;
  if (!title) return res.status(400).json({ error: "Title is required" });

  db.prepare(
    "UPDATE sop_documents SET title = ?, content = ?, category = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title, content, category, row.id);

  res.json({ sop: db.prepare("SELECT * FROM sop_documents WHERE id = ?").get(row.id) });
});

/** DELETE /:sopId */
router.delete("/:sopId", (req, res) => {
  const info = db
    .prepare("DELETE FROM sop_documents WHERE id = ? AND workspace_id = ?")
    .run(Number(req.params.sopId), req.workspace.id);
  if (!info.changes) return res.status(404).json({ error: "SOP not found" });
  res.status(204).end();
});

export default router;
