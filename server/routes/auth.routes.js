import { Router } from "express";
import db from "../db.js";
import { signToken } from "../lib/jwt.js";
import { hashPassword, comparePassword } from "../lib/passwords.js";
import authRequired from "../middleware/authRequired.js";

const router = Router();

router.get("/me", authRequired, (req, res) => {
  res.json({ user: req.user });
});

/**
 * POST /auth/verify-password — re-auth gate for the credentials vault.
 * Confirms the caller knows their MAIN account password without
 * invalidating the session. Wrong password → 401, no enumeration.
 */
router.post("/verify-password", authRequired, (req, res) => {
  const password = String(req.body?.password || "");
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!row || !comparePassword(password, row.password_hash)) {
    return res.status(401).json({ error: "Incorrect password" });
  }
  res.json({ ok: true, user: req.user });
});

function validateEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

router.post("/register", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!validateEmail(email)) return res.status(400).json({ error: "Valid email is required" });
  if (password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters" });

  try {
    const info = db
      .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)")
      .run(email, hashPassword(password));
    const user = { id: info.lastInsertRowid, email };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    if (err.message?.includes("UNIQUE")) {
      return res.status(409).json({ error: "An account with that email already exists" });
    }
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row) return res.status(401).json({ error: "Invalid email or password" });

  if (!comparePassword(password, row.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const user = { id: row.id, email: row.email };
  res.json({ token: signToken(user), user });
});

export default router;
