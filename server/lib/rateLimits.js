// Rate limiters (Phase 1.3) — brute-force resistance for the auth surface
// and the vault reveal route. All caps are env-tunable; windows are shared.
//
//   RATE_LIMIT_WINDOW_MINUTES      window length in minutes (default 15)
//   RATE_LIMIT_AUTH_IP_MAX         auth POSTs (login/register/verify-password)
//                                  per IP per window (default 30)
//   RATE_LIMIT_LOGIN_ACCOUNT_MAX   login attempts PER ACCOUNT (keyed by the
//                                  submitted email) per window (default 5) —
//                                  brute-forcing one account from many IPs
//                                  stays capped
//   RATE_LIMIT_REVEAL_MAX          vault reveals per user per window
//                                  (default 20)
//
// standardHeaders (draft-7) so clients can see Retry-After; legacy
// X-RateLimit-* headers are off. Responses are JSON with a stable code so
// the client can react (code: "RATE_LIMITED").
import rateLimit from "express-rate-limit";

const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const windowMs = () =>
  positiveInt(process.env.RATE_LIMIT_WINDOW_MINUTES, 15) * 60 * 1000;

const jsonLimit = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts — try again later", code: "RATE_LIMITED" },
};

/** Per-IP cap on auth POSTs (login / register / verify-password). */
export const authIpLimiter = rateLimit({
  ...jsonLimit,
  windowMs: windowMs(),
  limit: positiveInt(process.env.RATE_LIMIT_AUTH_IP_MAX, 30),
});

/**
 * Per-ACCOUNT cap on login attempts, keyed by the submitted email. This is
 * the brute-force stopper that per-IP limits cannot provide (an attacker
 * rotating IPs still hits this). Counts ALL attempts — a successful login
 * while locked is still refused, and lockouts expire with the window.
 */
export const loginAccountLimiter = rateLimit({
  ...jsonLimit,
  windowMs: windowMs(),
  limit: positiveInt(process.env.RATE_LIMIT_LOGIN_ACCOUNT_MAX, 5),
  keyGenerator: (req) => String(req.body?.email || "").trim().toLowerCase(),
});

/** Per-user cap on vault reveals (credential_id/.../reveal). */
export const revealLimiter = rateLimit({
  ...jsonLimit,
  windowMs: windowMs(),
  limit: positiveInt(process.env.RATE_LIMIT_REVEAL_MAX, 20),
  keyGenerator: (req) => String(req.user?.id ?? req.ip ?? "unknown"),
});
