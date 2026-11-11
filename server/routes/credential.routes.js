import { Router } from "express";
import db from "../db.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { verifyVaultToken } from "../lib/jwt.js";
import { revealLimiter } from "../lib/rateLimits.js";
import { strField } from "../lib/validate.js";

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
  if (strField(accountName, { name: "Account name", max: 120 }).error)
    return res.status(400).json({ error: "Account name too long (max 120 chars)" });
  if (secret === undefined || secret === null || String(secret).length === 0)
    return res.status(400).json({ error: "Password or token value is required" });
  // Phase 1.4: cap plaintext size BEFORE encryption (10k chars is generous)
  if (strField(String(secret), { name: "Secret", max: 10000 }).error)
    return res.status(400).json({ error: "Secret too long (max 10000 chars)" });

  const username = req.body?.username ? String(req.body.username) : null;
  if (username && strField(username, { name: "Username", max: 120 }).error)
    return res.status(400).json({ error: "Username too long (max 120 chars)" });
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
 *
 * Phase 1.2: every attempt is audited in credential_access_log —
 * 'reveal_denied' when the gate refuses, 'reveal' before decryption. The
 * audit write is FAIL-CLOSED: if it fails, the route returns 500 and never
 * decrypts (a vault without an audit trail is a vault we don't open).
 * No plaintext or token material is ever stored.
 *
 * Note: a 404 (credential not in this workspace) intentionally logs nothing —
 * the audit row requires a real credential_id (FK integrity over completeness).
 */
router.post("/:credId/reveal", revealLimiter, async (req, res) => {
  const row = await db
    .prepare("SELECT * FROM secure_credentials WHERE id = ? AND workspace_id = ?")
    .get(Number(req.params.credId), req.workspace.id);
  if (!row) return res.status(404).json({ error: "Credential not found" });

  // Test-only injection hook: makes the AUDIT INSERT target a sentinel table
  // that does not exist, proving the fail-closed behavior. Requires ALL of:
  // SWITCHBOARD_ALLOW_TX_INJECTION=1 on the server, this request header, and
  // a non-production NODE_ENV — unreachable in production (see
  // injection-guard.test.mjs for the pattern).
  const injectLogFailure =
    process.env.NODE_ENV !== "production" &&
    process.env.SWITCHBOARD_ALLOW_TX_INJECTION === "1" &&
    req.get("x-switchboard-log-fail") === "1";

  const writeAccessLog = async (action) => {
    const table = injectLogFailure
      ? "credential_access_log__injection_probe"
      : "credential_access_log";
    await db
      .prepare(
        `INSERT INTO ${table} (user_id, workspace_id, credential_id, action) VALUES (?, ?, ?, ?)`
      )
      .run(req.user.id, req.workspace.id, row.id, action);
  };

  try {
    verifyVaultToken(req.get("X-Vault-Token"), req.user.id);
  } catch {
    try {
      await writeAccessLog("reveal_denied");
    } catch (err) {
      console.error("[switchboard] credential audit write failed:", err.message);
      return res.status(500).json({ error: "Vault audit unavailable — reveal refused" });
    }
    return res.status(403).json({
      code: "VAULT_LOCKED",
      error: "Vault is locked — verify your account password to reveal secrets",
    });
  }

  try {
    await writeAccessLog("reveal"); // fail-closed: audit BEFORE decryption
  } catch (err) {
    console.error("[switchboard] credential audit write failed:", err.message);
    return res.status(500).json({ error: "Vault audit unavailable — reveal refused" });
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
