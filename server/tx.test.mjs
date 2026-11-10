// Phase 0.3 — direct db.tx() transaction tests (both dialects).
// Runs in its own process against the SAME throwaway database the runner's
// server booted with (SQLITE_PATH / DATABASE_URL come through the runner env),
// so the schema is already migrated when this file starts. Do not run it
// standalone against an empty database.
//
// Probe 1 is the core proof: a tx callback that WRITES and then THROWS must
// leave NO partial writes — on SQLite (BEGIN/COMMIT/ROLLBACK) as well as
// Postgres (callback statements on the tx client, not the pool).
import db from "./db.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

(async () => {
  // Throwaway fixtures (direct inserts; real FK graph so the probe is honest).
  const email = `tx-probe-${Date.now()}@txprobe.test`;
  const { lastID: userId } = await db
    .prepare("INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id")
    .run(email, "tx-probe-not-a-real-login-hash");
  const { lastID: wsId } = await db
    .prepare(
      "INSERT INTO client_workspaces (name, owner_id, plan_type, contract_hours) VALUES (?, ?, 'free', 5) RETURNING id"
    )
    .run("TX Probe Workspace", userId);
  const { lastID: taskId } = await db
    .prepare("INSERT INTO task_lists (workspace_id, title, status) VALUES (?, ?, 'todo') RETURNING id")
    .run(wsId, "Probe task");

  console.log("— db.tx(): write-then-throw leaves no partial writes —");
  let threw = false;
  try {
    await db.tx(async (txDb) => {
      await txDb.prepare("UPDATE task_lists SET status = 'done' WHERE id = ?").run(taskId);
      throw new Error("PROBE_INTENDED_FAILURE");
    });
  } catch (e) {
    threw = e && /PROBE_INTENDED_FAILURE/.test(e.message);
  }
  ok("tx propagates the callback's throw", threw);
  const row = await db.prepare("SELECT status FROM task_lists WHERE id = ?").get(taskId);
  ok("failed tx rolls back the mid-tx write", row && row.status === "todo", `got ${row && row.status}`);

  console.log("— db.tx(): committed tx persists its writes —");
  await db.tx(async (txDb) => {
    await txDb.prepare("UPDATE task_lists SET status = 'in_progress' WHERE id = ?").run(taskId);
  });
  const row2 = await db.prepare("SELECT status FROM task_lists WHERE id = ?").get(taskId);
  ok("successful tx commits", row2 && row2.status === "in_progress", `got ${row2 && row2.status}`);

  console.log("— db.tx(): concurrent transactions complete (serialization liveness) —");
  const news = await Promise.all(
    [1, 2, 3].map((i) =>
      db.tx(async (txDb) => {
        await txDb
          .prepare("INSERT INTO task_lists (workspace_id, title, status) VALUES (?, ?, 'todo') RETURNING id")
          .run(wsId, `concurrent ${i}`);
        return i;
      })
    )
  );
  const countRow = await db
    .prepare("SELECT COUNT(*) AS c FROM task_lists WHERE workspace_id = ?")
    .get(wsId);
  ok("3 concurrent txs all commit", news.filter(Boolean).length === 3 && countRow.c === 4, `committed ${news.length}, rows ${countRow.c}`);

  console.log("— Cleanup —");
  await db.prepare("DELETE FROM client_workspaces WHERE id = ?").run(wsId);
  await db.prepare("DELETE FROM users WHERE id = ?").run(userId);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("TX TEST CRASH:", e);
  process.exit(1);
});
