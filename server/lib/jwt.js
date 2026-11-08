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
