// Phase 1.2 — credential_access_log (who revealed what, when).
//
// Every reveal attempt writes an audit row: action 'reveal' on success,
// 'reveal_denied' when the vault-token gate refuses. The write is FAIL-CLOSED:
// if the audit insert fails, the route returns 500 and never decrypts.
// No plaintext and no token material is ever stored in the log.
//
// Log-write failure is proven via the runner's header-gated injection hook
// (same gating as the Phase 0.3 tx hook: requires SWITCHBOARD_ALLOW_TX_
// INJECTION=1 on the server AND the request header AND non-production mode).
import db from "./db.js";

const BASE = process.env.SMOKE_API_BASE || "http://localhost:3001/api";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const call = async (path, { method = "GET", body, token, headers: extra = {} } = {}) => {
  const headers = { ...extra };
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
};

const logsFor = async (credId) => {
  try {
    return await db.prepare("SELECT * FROM credential_access_log WHERE credential_id = ? ORDER BY id").all(credId);
  } catch (err) {
    return { __error: err.message };
  }
};

(async () => {
  const pw = "AuditProbePassword1";
  const email = `audit-probe-${Date.now()}@devswitchboard.io`;

  let r = await call("/auth/register", { method: "POST", body: { email, password: pw } });
  ok("setup: registered", r.status === 201 && r.data.token, `got ${r.status}`);
  const token = r.data.token;
  const userId = (await call("/auth/me", { token })).data.user.id;

  r = await call("/workspaces", { method: "POST", token, body: { name: "Audit Probe WS" } });
  ok("setup: workspace", r.status === 201, `got ${r.status}`);
  const wsId = r.data.workspace.id;
  r = await call(`/workspaces/${wsId}/credentials`, {
    method: "POST", token,
    body: { account_name: "Audit Probe", encrypted_password_or_token: "AUDIT-PLAINTEXT-PROBE" },
  });
  ok("setup: credential", r.status === 201, `got ${r.status}`);
  const credId = r.data.credential.id;

  console.log("— Denied attempts are logged —");
  r = await call(`/workspaces/${wsId}/credentials/${credId}/reveal`, { method: "POST", token });
  ok("reveal without vault token → 403", r.status === 403 && r.data.code === "VAULT_LOCKED", `got ${r.status}`);
  let logs = await logsFor(credId);
  ok("reveal_denied row written",
    !logs.__error && logs.length === 1 && logs[0].action === "reveal_denied",
    logs.__error || `got ${logs.length} rows`);
  ok("denied row binds user + workspace",
    !logs.__error && logs[0]?.user_id === userId && logs[0]?.workspace_id === wsId,
    JSON.stringify(logs[0] ?? null));

  console.log("— Successful reveals are logged —");
  r = await call("/auth/verify-password", { method: "POST", body: { password: pw }, token });
  const vault = r.data?.vault_token;
  ok("setup: vault token minted", r.status === 200 && typeof vault === "string", `got ${r.status}`);
  r = await call(`/workspaces/${wsId}/credentials/${credId}/reveal`, {
    method: "POST", token, headers: { "X-Vault-Token": vault },
  });
  ok("reveal with token → 200", r.status === 200 && r.data.plaintext === "AUDIT-PLAINTEXT-PROBE", `got ${r.status}`);
  logs = await logsFor(credId);
  ok("reveal row appended after success",
    !logs.__error && logs.length === 2 && logs[1].action === "reveal",
    logs.__error || `got ${logs.length} rows: ${logs.map((l) => l.action).join(",")}`);

  ok("log stores NO plaintext", !JSON.stringify(logs).includes("AUDIT-PLAINTEXT-PROBE"));
  ok("log stores NO token material", !JSON.stringify(logs).includes(vault.slice(0, 24)));

  console.log("— Fail-closed: audit write failure refuses the reveal —");
  r = await call(`/workspaces/${wsId}/credentials/${credId}/reveal`, {
    method: "POST",
    token,
    headers: { "X-Vault-Token": vault, "x-switchboard-log-fail": "1" }, // injected audit-write failure
  });
  ok("audit write failure → 500", r.status === 500, `got ${r.status}`);
  ok("fail-closed response leaks NO plaintext", !JSON.stringify(r.data).includes("AUDIT-PLAINTEXT-PROBE"));
  logs = await logsFor(credId);
  ok("failed audit write left NO new row", !logs.__error && logs.length === 2, `got ${logs.length} rows`);

  // Cleanup: workspace delete cascades credential + log rows.
  await call(`/workspaces/${wsId}`, { method: "DELETE", token });

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
