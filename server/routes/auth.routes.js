import { Router } from "express";
import db from "../db.js";
import { signToken, signVaultToken } from "../lib/jwt.js";
import { hashPassword, comparePassword } from "../lib/passwords.js";
import { authIpLimiter, loginAccountLimiter } from "../lib/rateLimits.js";
import authRequired from "../middleware/authRequired.js";

const router = Router();

router.get("/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

/**
 * POST /auth/verify-password — re-auth gate for the credentials vault.
 * Confirms the caller knows their MAIN account password without
 * invalidating the session. Wrong password → 401, no enumeration.
 *
 * Phase 1.1: on success this ALSO issues a short-lived vault token
 * (default 5 min, user-bound, distinct `purpose`). The credentials
 * vault's reveal route requires it server-side (X-Vault-Token header).
 */
router.post("/verify-password", authIpLimiter, authRequired, async (req, res) => {
  const password = String(req.body?.password || "");
  const row = await db
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(req.user.id);
  if (!row || !(await comparePassword(password, row.password_hash))) {
    return res.status(401).json({ error: "Incorrect password" });
  }
  res.json({ ok: true, vault_token: signVaultToken(req.user.id), user: req.user });
});

function validateEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

router.post("/register", authIpLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!validateEmail(email)) return res.status(400).json({ error: "Valid email is required" });
  if (password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters" });

  try {
    const { lastID } = await db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id")
      .run(email, await hashPassword(password));
    const user = { id: lastID, email };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    // 23505 = Postgres unique violation; SQLite includes 'UNIQUE' in message
    if (err.code === "23505" || err.message?.includes("UNIQUE")) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/login", authIpLimiter, loginAccountLimiter, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const row = await db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row) return res.status(401).json({ error: "Invalid email or password" });

  if (!(await comparePassword(password, row.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const user = { id: row.id, email: row.email };
  res.json({ token: signToken(user), user });
});

export default router;
