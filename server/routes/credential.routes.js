import { Router } from "express";
import db from "../db.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";

const router = Router();

const MASK = "••••••••";

/** GET / — NEVER decrypts; masked values only */
router.get("/", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM secure_credentials WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(req.workspace.id);
  res.json({
    credentials: rows.map(({ enc_payload, ...safe }) => ({
      ...safe,
      masked_value: MASK,
      has_secret: true,
    })),
  });
});

/** POST / — encrypts before storage */
router.post("/", (req, res) => {
  const accountName = String(req.body?.account_name || "").trim();
  const secret = req.body?.encrypted_password_or_token ?? req.body?.secret;
  if (!accountName) return res.status(400).json({ error: "Account name is required" });
  if (secret === undefined || secret === null || String(secret).length === 0)
    return res.status(400).json({ error: "Password or token value is required" });

  const username = req.body?.username ? String(req.body.username) : null;
  const enc = encryptSecret(String(secret));

  const info = db
    .prepare(
      "INSERT INTO secure_credentials (workspace_id, account_name, username, enc_payload) VALUES (?, ?, ?, ?)"
    )
    .run(req.workspace.id, accountName, username, enc);

  const row = db.prepare("SELECT * FROM secure_credentials WHERE id = ?").get(info.lastInsertRowid);
  const { enc_payload, ...safe } = row;
  res.status(201).json({ credential: { ...safe, masked_value: MASK } });
});

/**
 * POST /workspaces/:id/credentials/:credId/reveal
 * Dedicated decryption route — opt-in only, returns plaintext once.
 */
router.post("/:credId/reveal", (req, res) => {
  const row = db
    .prepare("SELECT * FROM secure_credentials WHERE id = ? AND workspace_id = ?")
    .get(Number(req.params.credId), req.workspace.id);
  if (!row) return res.status(404).json({ error: "Credential not found" });

  try {
    res.json({ id: row.id, plaintext: decryptSecret(row.enc_payload) });
  } catch {
    res.status(500).json({ error: "Decryption failed — data may be corrupted" });
  }
});

/** DELETE /workspaces/:id/credentials/:credId */
router.delete("/:credId", (req, res) => {
  const info = db
    .prepare("DELETE FROM secure_credentials WHERE id = ? AND workspace_id = ?")
    .run(Number(req.params.credId), req.workspace.id);
  if (!info.changes) return res.status(404).json({ error: "Credential not found" });
  res.status(204).end();
});

export default router;
