import "dotenv/config";
import express from "express";
import cors from "cors";
import db, { migrate } from "./db.js";
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

migrate();
app.use(cors());
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

app.listen(PORT, () => {
  console.log(`[switchboard] API ready on http://localhost:${PORT}`);
});
