import jwt from "jsonwebtoken";

/* Production secret safety (P5):
   - production NEVER falls back to a dev secret and must boot with a real,
     sufficiently long JWT_SECRET — bad config kills startup, not runtime.
   - development keeps a documented fallback so local dev works out of the box. */
const isProd = process.env.NODE_ENV === "production";
if (isProd && !process.env.JWT_SECRET) {
  throw new Error(
    "[switchboard] Boot aborted: JWT_SECRET must be set in production. No development fallback is allowed."
  );
}

const secret = process.env.JWT_SECRET || "dev_insecure_secret";

if (process.env.JWT_SECRET?.includes("change_me")) {
  const msg =
    "[switchboard] JWT_SECRET contains the development placeholder 'change_me' — set a real random secret.";
  if (isProd) throw new Error(msg);
  console.warn(`[switchboard] WARNING: ${msg}`);
}
if (isProd && secret.length < 32) {
  throw new Error("[switchboard] Boot aborted: JWT_SECRET must be at least 32 characters in production.");
}
if (!isProd && !process.env.JWT_SECRET) {
  console.warn("[switchboard] dev warning: JWT_SECRET not set — using insecure fallback (dev only).");
}

export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: "7d" });
}

export function verifyToken(token) {
  return jwt.verify(token, secret);
}

// ── Vault tokens (Phase 1.1) ────────────────────────────────────────────────
// A separate, short-lived token PURPOSE for the credentials vault. The login
// JWT carries no `purpose` claim, so it can never be replayed as a vault
// token, and each vault token is bound to the user id it was issued for.
const vaultTtlMinutes = () => {
  const n = Number(process.env.VAULT_TOKEN_TTL_MINUTES);
  return Number.isFinite(n) && n > 0 && n <= 120 ? n : 5; // default: 5 minutes
};

export function signVaultToken(userId) {
  return jwt.sign({ id: userId, purpose: "vault" }, secret, {
    expiresIn: `${vaultTtlMinutes()}m`,
  });
}

/**
 * Verify a vault token FOR A SPECIFIC USER. Throws on bad signature, expiry,
 * wrong purpose (e.g. a login JWT), or a token minted for a different user.
 * Callers must treat any throw as VAULT_LOCKED.
 */
export function verifyVaultToken(token, userId) {
  const payload = jwt.verify(String(token || ""), secret);
  if (payload.purpose !== "vault" || payload.id !== userId) {
    throw new Error("Vault token is not valid for this user");
  }
  return payload;
}
