import { Router } from "express";
import db from "../db.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { verifyVaultToken } from "../lib/jwt.js";

const router = Router();

const MASK = "••••••••";

/** GET / — NEVER decrypts; masked values only */
router.get("/", async (req, res) => {
  const rows = await db
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
router.post("/", async (req, res) => {
  const accountName = String(req.body?.account_name || "").trim();
  const secret = req.body?.encrypted_password_or_token ?? req.body?.secret;
  if (!accountName) return res.status(400).json({ error: "Account name is required" });
  if (secret === undefined || secret === null || String(secret).length === 0)
    return res.status(400).json({ error: "Password or token value is required" });

  const username = req.body?.username ? String(req.body.username) : null;
  const enc = encryptSecret(String(secret));

  const { lastID } = await db
    .prepare(
      "INSERT INTO secure_credentials (workspace_id, account_name, username, enc_payload) VALUES (?, ?, ?, ?) RETURNING id"
    )
    .run(req.workspace.id, accountName, username, enc);

  const row = await db.prepare("SELECT * FROM secure_credentials WHERE id = ?").get(lastID);
  const { enc_payload, ...safe } = row;
  res.status(201).json({ credential: { ...safe, masked_value: MASK } });
});

/**
 * POST /workspaces/:id/credentials/:credId/reveal
 * Dedicated decryption route — opt-in only, returns plaintext once.
 *
 * Phase 1.1: SERVER-enforced vault gate. The caller must present the
 * short-lived vault token issued by /auth/verify-password (X-Vault-Token
 * header). Missing, expired, wrong-purpose (login JWT), or foreign-user
 * tokens all → 403 VAULT_LOCKED; plaintext is never touched on denial.
 */
router.post("/:credId/reveal", async (req, res) => {
  const row = await db
    .prepare("SELECT * FROM secure_credentials WHERE id = ? AND workspace_id = ?")
    .get(Number(req.params.credId), req.workspace.id);
  if (!row) return res.status(404).json({ error: "Credential not found" });

  try {
    verifyVaultToken(req.get("X-Vault-Token"), req.user.id);
  } catch {
    return res.status(403).json({
      code: "VAULT_LOCKED",
      error: "Vault is locked — verify your account password to reveal secrets",
    });
  }

  try {
    res.json({ id: row.id, plaintext: decryptSecret(row.enc_payload) });
  } catch {
    res.status(500).json({ error: "Decryption failed — data may be corrupted" });
  }
});

/** DELETE /workspaces/:id/credentials/:credId */
router.delete("/:credId", async (req, res) => {
  const { changes } = await db
    .prepare("DELETE FROM secure_credentials WHERE id = ? AND workspace_id = ?")
    .run(Number(req.params.credId), req.workspace.id);
  if (!changes) return res.status(404).json({ error: "Credential not found" });
  res.status(204).end();
});

export default router;
