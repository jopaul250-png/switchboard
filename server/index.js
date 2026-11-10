import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { migrate } from "./db.js";
import { authIpLimiter } from "./lib/rateLimits.js";
import authRequired from "./middleware/authRequired.js";
import workspaceScope from "./middleware/workspaceScope.js";
import authRoutes from "./routes/auth.routes.js";
import workspaceRoutes from "./routes/workspace.routes.js";
import sopRoutes from "./routes/sop.routes.js";
import credentialRoutes from "./routes/credential.routes.js";
import taskRoutes from "./routes/task.routes.js";
import pulseRoutes from "./routes/pulse.routes.js";
import timeLogRoutes from "./routes/timeLog.routes.js";

const app = express();
const PORT = process.env.PORT || 3001;

/* P5: the lib/jwt.js + lib/crypto.js modules fail boot in production when
   secrets are missing or insecure. Dev-only fallbacks stay local to dev. */

// Phase 1.3: Render terminates TLS in front of the app (one proxy hop), so
// express-rate-limit must trust X-Forwarded-For to see the real client IP —
// otherwise every request would share the proxy's IP and one attacker could
// lock out everyone. 1 hop = Render's router.
app.set("trust proxy", 1);

// Baseline security headers on every response. CORP stays "cross-origin" so
// the Vercel-hosted client keeps working against this API cross-origin.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// Per-request first-best middlewares
app.use(
  cors({
    // Phase 3 config: exact-origins allowlist in production, open in dev.
    ...(process.env.CORS_ORIGIN
      ? {
          origin: String(process.env.CORS_ORIGIN)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          credentials: true,
        }
      : {}),
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, app: "switchboard" }));

// 1) auth — public
app.use("/api/auth", authRoutes);

// 2) scoped resources — auth + workspace ownership
const scoped = [authRequired, workspaceScope];
app.use("/api/workspaces/:workspaceId/sops", scoped, sopRoutes);
app.use("/api/workspaces/:workspaceId/credentials", scoped, credentialRoutes);
app.use("/api/workspaces/:workspaceId/tasks", scoped, taskRoutes);
app.use("/api/workspaces/:workspaceId/pulse", scoped, pulseRoutes);
app.use("/api/workspaces/:workspaceId/time-logs", scoped, timeLogRoutes);

// 3) workspaces root — list / create / detail. The scoped mounts above take
//    precedence for sub-resources; this router handles "/" and "/:workspaceId".
app.use("/api/workspaces", authRequired, workspaceRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Phase 2: idempotent schema migration runs before listening (Postgres or
// SQLite depending on DATABASE_URL). Boot fails loudly if the DB is unreachable.
migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[switchboard] API ready on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("[switchboard] Boot aborted: database migration failed:", err.message);
    process.exit(1);
  });
