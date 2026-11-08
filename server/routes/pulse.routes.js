import { Router } from "express";
import db from "../db.js";

const router = Router();

const CHANNELS = ["Slack", "Email", "WhatsApp"];

/** GET /workspaces/:id/pulse — per-queue counters + total */
router.get("/", async (req, res) => {
  let feeds = await db
    .prepare("SELECT * FROM pulse_feeds WHERE workspace_id = ?")
    .all(req.workspace.id);

  // Guarantee all three queues exist
  const missing = CHANNELS.filter((c) => !feeds.some((f) => f.channel === c));
  for (const channel of missing) {
    await db.prepare(
      "INSERT INTO pulse_feeds (workspace_id, channel) VALUES (?, ?) ON CONFLICT DO NOTHING"
    ).run(req.workspace.id, channel);
  }
  if (missing.length) {
    feeds = await db.prepare("SELECT * FROM pulse_feeds WHERE workspace_id = ?").all(req.workspace.id);
  }

  const total_unread = feeds.reduce((sum, f) => sum + f.unread_count, 0);
  res.json({ feeds, total_unread });
});

/** POST /workspaces/:id/pulse/simulate — random incoming messages */
router.post("/simulate", async (req, res) => {
  const channel = CHANNELS.includes(req.body?.channel)
    ? req.body.channel
    : CHANNELS[Math.floor(Math.random() * CHANNELS.length)];
  const count = Math.ceil(Math.random() * 3);

  const samples = {
    Slack: ["New thread reply", "Mention in #daily-standup", "DM from client"],
    Email: ["Invoice sent confirmation", "New ticket reply", "Document request"],
    WhatsApp: ["Singapore call ping", "US client voice note", "Group broadcast"],
  };
  const msg = samples[channel][Math.floor(Math.random() * samples[channel].length)];

  // JS-generated ISO timestamp: dialect-agnostic (no SQLite/PG SQL default).
  await db.prepare(
    `UPDATE pulse_feeds
     SET unread_count = unread_count + ?, last_message = ?, updated_at = ?
     WHERE workspace_id = ? AND channel = ?`
  ).run(count, msg, new Date().toISOString(), req.workspace.id, channel);

  const feeds = await db
    .prepare("SELECT * FROM pulse_feeds WHERE workspace_id = ?")
    .all(req.workspace.id);
  res.json({
    simulated: { channel, count, message: msg },
    feeds,
    total_unread: feeds.reduce((s, f) => s + f.unread_count, 0),
  });
});

/** POST /workspaces/:id/pulse/clear — single action resets everything to 0 */
router.post("/clear", async (req, res) => {
  await db.prepare(
    "UPDATE pulse_feeds SET unread_count = 0, updated_at = ? WHERE workspace_id = ?"
  ).run(new Date().toISOString(), req.workspace.id);

  const feeds = await db
    .prepare("SELECT * FROM pulse_feeds WHERE workspace_id = ?")
    .all(req.workspace.id);
  res.json({ feeds, total_unread: 0 });
});

export default router;
