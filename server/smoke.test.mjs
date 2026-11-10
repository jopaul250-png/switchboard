// Switchboard end-to-end smoke test
// Base URL is configurable so the test runner can boot the API on a fresh,
// never-before-used port (SMOKE_API_BASE). Falls back to the dev default.
const BASE = process.env.SMOKE_API_BASE || "http://localhost:3001/api";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const call = async (path, { method = "GET", body, token, headers: extraHeaders = {} } = {}) => {
  const headers = { ...extraHeaders };
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
};

(async () => {
  const email = `va-test-${Date.now()}@devswitchboard.io`;
  const pass1 = "SuperSecretVA9";

  console.log("— Auth —");
  let r = await call("/auth/register", { method: "POST", body: { email, password: pass1 } });
  ok("register 201", r.status === 201 && r.data.token);
  const token = r.data.token;
  r = await call("/auth/me", { token });
  ok("me echoes user", r.status === 200 && r.data.user.email === email);
  r = await call("/auth/login", { method: "POST", body: { email, password: pass1 } });
  ok("login 200", r.status === 200 && r.data.token);
  r = await call("/auth/login", { method: "POST", body: { email, password: "wrong" } });
  ok("bad login 401", r.status === 401);
  r = await call("/auth/verify-password", { method: "POST", body: { password: "wrongpass" }, token });
  ok("verify-password rejects wrong pw 401", r.status === 401);
  r = await call("/auth/verify-password", { method: "POST", body: { password: pass1 }, token });
  ok("verify-password accepts real pw", r.status === 200 && r.data.ok === true);
  r = await call("/auth/verify-password", { method: "POST", body: { password: pass1 } });
  ok("verify-password requires auth", r.status === 401);

  console.log("— Plan limits (M3 free cap = 2) —");
  r = await call("/workspaces", { method: "POST", token, body: { name: "Client A" } });
  ok("create ws1", r.status === 201);
  const wsA = r.data.workspace;
  r = await call("/workspaces", { method: "POST", token, body: { name: "Client B", contract_hours: 10 } });
  ok("create ws2", r.status === 201 && r.data.workspace.contract_hours === 10);
  const wsB = r.data.workspace;
  r = await call("/workspaces", { method: "POST", token, body: { name: "Client C" } });
  ok("3rd workspace blocked 402", r.status === 402 && r.data.code === "WORKSPACE_LIMIT");
  r = await call(`/workspaces/${wsA.id}`, { method: "PATCH", token, body: { plan_type: "premium" } });
  ok("upgrade ws1 to premium", r.status === 200 && r.data.workspace.plan_type === "premium");
  r = await call("/workspaces", { method: "POST", token, body: { name: "Client C" } });
  ok("premium frees slot → create ws3", r.status === 201);
  const wsC = r.data.workspace;
  r = await call("/workspaces", { token });
  ok("list shows pulse_unread + counts", r.data.workspaces.length === 3 &&
      r.data.workspaces.every((w) => typeof w.pulse_unread === "number"));

  console.log("— SOP vault —");
  r = await call(`/workspaces/${wsA.id}/sops`, { method: "POST", token, body: { title: "Brand Rules", category: "brand-guidelines", content: "# Voice\nPrimary **#1E90FF** blue" } });
  ok("sop create", r.status === 201);
  const sop = r.data.sop;
  r = await call(`/workspaces/${wsA.id}/sops/${sop.id}`, { method: "PUT", token, body: { title: "Brand Rules v2" } });
  ok("sop update", r.status === 200 && r.data.sop.title === "Brand Rules v2");
  ok("sop updated_at is canonical ISO-8601-Z (Phase 0.2)", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(r.data.sop.updated_at), `got ${r.data.sop.updated_at}`);
  r = await call(`/workspaces/${wsA.id}/sops`, { token });
  ok("sop list", r.data.sops.length === 1);

  console.log("— Credentials locker (encryption) —");
  r = await call(`/workspaces/${wsA.id}/credentials`, { method: "POST", token, body: { account_name: "Mailchimp", username: "ops@summit.co", encrypted_password_or_token: "PLAINTEXT-SECRET-XYZ" } });
  ok("cred create 201", r.status === 201);
  const cred = r.data.credential;
  ok("cred created_at is canonical ISO-8601-Z (Phase 0.2)", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(cred.created_at), `got ${cred.created_at}`);
  ok("list never echoes plaintext", !JSON.stringify(r.data).includes("PLAINTEXT-SECRET-XYZ"));
  r = await call(`/workspaces/${wsA.id}/credentials/${cred.id}/reveal`, { method: "POST", token });
  ok("reveal decrypts via dedicated route", r.status === 200 && r.data.plaintext === "PLAINTEXT-SECRET-XYZ");
  r = await call(`/workspaces/${wsA.id}/credentials`, { token });
  ok("list shows masked ••••••••", r.data.credentials[0].masked_value === "••••••••");

  console.log("— Scope meter accounting (P2 actuals-only model) —");
  r = await call(`/workspaces/${wsB.id}/tasks`, { method: "POST", token, body: { title: "Newsletter", estimated_hours: 6 } });
  ok("task create", r.status === 201);
  const task = r.data.task;
  r = await call(`/workspaces/${wsB.id}/tasks/${task.id}`, { method: "PATCH", token, body: { status: "done" } });
  ok("done does NOT book estimated hours", r.status === 200 && r.data.task.status === "done" && r.data.scope.hours_used === 0);
  {
    const d = await call(`/workspaces/${wsB.id}`, { token });
    ok("meter derived from actuals only", d.data.workspace.hours_used === 0);
  }
  r = await call(`/workspaces/${wsB.id}/time-logs`, { method: "POST", token, body: { task_description: "Email triage", duration_seconds: 1800, started_at: "2026-11-07T10:00:00Z" } });
  ok("time log adds actual 1800s → 0.5h", r.status === 201 && r.data.scope.hours_used === 0.5);
  const logA = r.data.log;
  r = await call(`/workspaces/${wsB.id}/time-logs`, { method: "POST", token, body: { task_description: "Report build", duration_seconds: 3600, started_at: "2026-11-07T13:00:00Z" } });
  ok("second log → tracked 1.5h", r.status === 201 && r.data.scope.tracked_hours === 1.5 && r.data.scope.hours_used === 1.5);
  const logB = r.data.log;
  r = await call(`/workspaces/${wsB.id}`, { method: "PATCH", token, body: { hours_manual: 2 } });
  ok("manual adjustment recorded separately", r.data.scope.manual_hours === 2 && r.data.scope.hours_used === 3.5);
  r = await call(`/workspaces/${wsB.id}/tasks/${task.id}`, { method: "PATCH", token, body: { status: "todo" } });
  ok("moving task off done leaves meter unchanged", r.status === 200 && r.data.scope.hours_used === 3.5);
  r = await call(`/workspaces/${wsB.id}/time-logs/${logB.id}`, { method: "DELETE", token });
  ok("delete log reverses only its own actual hours", r.status === 200 && r.data.scope.hours_used === 2.5 && r.data.scope.manual_hours === 2);
  {
    const d = await call(`/workspaces/${wsB.id}/time-logs`, { token });
    ok("time-log list reflects deletion", d.data.logs.length === 1 && d.data.logs[0].id === logA.id);
  }
  r = await call(`/workspaces/${wsB.id}/tasks/${task.id}`, { method: "PATCH", token, body: { status: "in_progress" } });
  ok("move to in_progress", r.data.task.status === "in_progress" && r.data.scope.hours_used === 2.5);

  console.log("— Pulse widget —");
  r = await call(`/workspaces/${wsC.id}/pulse`, { token });
  ok("3 queues seeded", r.data.feeds.length === 3 && r.data.total_unread === 0);
  r = await call(`/workspaces/${wsC.id}/pulse/simulate`, { method: "POST", token });
  ok("simulate adds unread", r.status === 200 && r.data.total_unread > 0);
  const unreadTotal = r.data.total_unread;
  {
    const d = await call("/workspaces", { token });
    ok("sidebar badge aggregates pulse", d.data.workspaces.find((w) => w.id === wsC.id).pulse_unread === unreadTotal);
  }
  r = await call(`/workspaces/${wsC.id}/pulse/clear`, { method: "POST", token });
  ok("clear feed resets to 0", r.data.total_unread === 0 && r.data.feeds.every((f) => f.unread_count === 0));

  console.log("— Transactions roll back on failure (Phase 0.3) —");
  // Mid-transaction failure injected AFTER the workspace INSERT (test-only hook,
  // requires the runner's SWITCHBOARD_ALLOW_TX_INJECTION=1 plus this header).
  r = await call("/workspaces", {
    method: "POST",
    token,
    body: { name: "TX-Injection Client", plan_type: "premium" }, // premium to pass the free-cap middleware
    headers: { "x-switchboard-tx-fail": "1" },
  });
  ok("injected mid-tx failure → 500", r.status === 500, `got ${r.status}`);
  {
    const d = await call("/workspaces", { token });
    ok("failed workspace-create tx leaves NO workspace row",
      d.status === 200 && d.data.workspaces.length === 3 && !d.data.workspaces.some((w) => w.name === "TX-Injection Client"),
      `got ${d.data.workspaces.length} workspaces`);
  }
  // FK violation mid-tx: the accepted status UPDATE must be rolled back.
  r = await call(`/workspaces/${wsB.id}/tasks/${task.id}`, {
    method: "PATCH",
    token,
    body: { status: "done", assigned_to: 999999999 },
  });
  ok("task PATCH with FK-violating assigned_to → 500", r.status === 500, `got ${r.status}`);
  {
    const d = await call(`/workspaces/${wsB.id}/tasks`, { token });
    const t = d.data.tasks.find((x) => x.id === task.id);
    ok("failed task PATCH rolled back (status unchanged)", d.status === 200 && t && t.status === "in_progress", `got ${t && t.status}`);
  }

  console.log("— Tenant isolation —");
  r = await call(`/workspaces/${wsC.id}/sops`, { token }); // wsC has no SOPs; wsA's sop must not leak
  ok("scoped list empty in other ws", r.status === 200 && r.data.sops.length === 0);
  const fake = await call(`/workspaces/99999/tasks`, { token });
  ok("foreign/nonexistent ws → 404", fake.status === 404);
  const noToken = await call("/workspaces");
  ok("no token → 401", noToken.status === 401);

  console.log("— Cross-tenant isolation (P6: two independent users, REAL foreign ids) —");
  const emailB = `rival-probe-${Date.now()}@devswitchboard.io`;
  r = await call("/auth/register", { method: "POST", body: { email: emailB, password: pass1 } });
  ok("user B registered", r.status === 201 && r.data.token);
  const tokenB = r.data.token;
  const aIds = [wsA.id, wsB.id, wsC.id];

  r = await call("/workspaces", { token: tokenB });
  ok("B's list excludes all of A's workspaces", r.status === 200 && !r.data.workspaces.some((w) => aIds.includes(w.id)));

  let all404 = true;
  for (const id of aIds) {
    const x = await call(`/workspaces/${id}/tasks`, { token: tokenB });
    if (x.status !== 404) all404 = false;
  }
  ok("B cannot read A's tasks (real ws ids → 404)", all404);

  r = await call(`/workspaces/${wsA.id}/sops/${sop.id}`, { method: "PUT", token: tokenB, body: { title: "HACKED" } });
  ok("B cannot modify A's SOP → 404", r.status === 404);
  r = await call(`/workspaces/${wsA.id}/sops/${sop.id}`, { method: "DELETE", token: tokenB });
  ok("B cannot delete A's SOP → 404", r.status === 404);
  {
    const d = await call(`/workspaces/${wsA.id}/sops/${sop.id}`, { token });
    ok("A's SOP intact + unmodified after B's attempts", d.status === 200 && d.data.sop.title === "Brand Rules v2");
  }

  r = await call(`/workspaces/${wsA.id}/credentials`, { token: tokenB });
  ok("B cannot list A's credentials → 404", r.status === 404);
  r = await call(`/workspaces/${wsA.id}/credentials/${cred.id}/reveal`, { method: "POST", token: tokenB });
  ok("B cannot reveal A's credential → 404", r.status === 404);
  r = await call(`/workspaces/${wsA.id}/credentials/${cred.id}`, { method: "DELETE", token: tokenB });
  ok("B cannot delete A's credential → 404", r.status === 404);
  // tampering has not decrypted it for B either: secret still decrypts for A only via original route
  r = await call(`/workspaces/${wsA.id}/credentials/${cred.id}/reveal`, { method: "POST", token });
  ok("owner's reveal still works after B's attempts", r.status === 200 && r.data.plaintext === "PLAINTEXT-SECRET-XYZ");

  {
    const x = await call(`/workspaces/${wsB.id}/time-logs/${logA.id}`, { method: "DELETE", token: tokenB });
    const y = await call(`/workspaces/${wsB.id}`, { token });
    ok("B cannot touch A's time log (404 + log intact)", x.status === 404 && y.data.scope.hours_used === 2.5);
  }

  ok("B cannot move A's task → 404", (await call(`/workspaces/${wsB.id}/tasks/${task.id}`, { method: "PATCH", token: tokenB, body: { status: "todo" } })).status === 404);
  ok("B cannot delete A's task → 404", (await call(`/workspaces/${wsB.id}/tasks/${task.id}`, { method: "DELETE", token: tokenB })).status === 404);

  ok("B cannot read A's pulse feed → 404", (await call(`/workspaces/${wsC.id}/pulse`, { token: tokenB })).status === 404);
  ok("B cannot simulate into A's pulse → 404", (await call(`/workspaces/${wsC.id}/pulse/simulate`, { method: "POST", token: tokenB })).status === 404);
  ok("B cannot clear A's pulse → 404", (await call(`/workspaces/${wsC.id}/pulse/clear`, { method: "POST", token: tokenB })).status === 404);

  r = await call(`/workspaces/${wsA.id}`, { method: "PATCH", token: tokenB, body: { name: "stolen" } });
  ok("B cannot rename A's workspace → 404", r.status === 404);
  r = await call(`/workspaces/${wsA.id}`, { method: "DELETE", token: tokenB });
  ok("B cannot delete A's workspace → 404", r.status === 404);
  {
    const d = await call("/workspaces", { token });
    ok("all of A's workspaces survive B's attacks", d.status === 200 && d.data.workspaces.length === 3);
  }

  console.log("— Cleanup —");
  for (const id of [wsA.id, wsB.id, wsC.id]) {
    r = await call(`/workspaces/${id}`, { method: "DELETE", token });
    ok(`delete ws ${id}`, r.status === 204);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
