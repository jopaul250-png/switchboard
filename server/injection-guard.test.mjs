// Phase 0 security requirement: the test-only failure-injection hook must be
// UNREACHABLE when the server runs with NODE_ENV=production, even if
// SWITCHBOARD_ALLOW_TX_INJECTION=1 (set by the runner) and the special request
// header are both present. The runner boots a LOCAL production-mode server
// (throwaway DB, test secrets) specifically for this file.
//
// Expectation: workspace creation SUCCEEDS (201) — the injection header is
// ignored. If the hook were reachable, this POST would 500 and the test fails.
const BASE = process.env.SMOKE_API_BASE || "http://localhost:3001/api";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

(async () => {
  const email = `injection-guard-${Date.now()}@guard.test`;
  let r = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "GuardCheckPassword1" }),
  });
  const reg = await r.json().catch(() => null);
  ok("register 201", r.status === 201 && reg?.token, `got ${r.status}`);
  const token = reg?.token;

  r = await fetch(`${BASE}/workspaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-switchboard-tx-fail": "1", // would trigger injection if the hook were reachable
    },
    body: JSON.stringify({ name: "Guard Probe", plan_type: "premium" }),
  });
  const created = await r.json().catch(() => null);
  ok("injection hook NOT reachable in production mode (201, not 500)", r.status === 201, `got ${r.status}`);
  ok("workspace actually created", r.status === 201 && created?.workspace?.id, "no workspace id");

  if (created?.workspace?.id) {
    const d = await fetch(`${BASE}/workspaces`, { headers: { Authorization: `Bearer ${token}` } });
    const list = await d.json().catch(() => null);
    ok("workspace persisted and listed", list?.workspaces?.some((w) => w.id === created.workspace.id), "missing from list");
    // Cleanup
    const del = await fetch(`${BASE}/workspaces/${created.workspace.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    ok("cleanup delete 204", del.status === 204, `got ${del.status}`);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
