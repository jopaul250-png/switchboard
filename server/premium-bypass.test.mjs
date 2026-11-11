// Phase 2.4 — PREMIUM BYPASS FIX: REGRESSION TEST (inverted from Phase 1.5).
//
// The Phase 1.5 version of this file PROVED the bypass end-to-end (every
// [VULNERABLE] assertion PASSED against the then-current server). Per the
// owner decision implemented in Phase 2.4:
//
//   1. The server IGNORES client-sent plan_type on POST and PATCH entirely.
//   2. ONE account-wide workspace cap (env WORKSPACE_CAP, default 10),
//      counting ALL owned workspaces — no free/premium slot split.
//   3. Existing plan_type values are never rewritten by client requests.
//
// The assertions below expect REFUSAL or IGNORE. Run against the pre-2.4
// server they FAIL — that failing run is the fail-before evidence.
// The [CAP-INTACT] section stays (updated from free-cap-2 to account-wide
// cap-10 semantics): 10 workspaces are created, the 11th is refused.

const BASE = process.env.SMOKE_API_BASE || "http://localhost:3001/api";
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const call = async (path, { method = "GET", body, token } = {}) => {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
};

(async () => {
  const email = `bypass-probe-${Date.now()}@devswitchboard.io`;
  const password = "SuperSecretVA9";

  let r = await call("/auth/register", { method: "POST", body: { email, password } });
  ok("setup: user registered", r.status === 201 && r.data.token, `got ${r.status}`);
  const token = r.data.token;
  const created = [];

  console.log("— [FIXED] Vector A: creation-time plan_type is ignored —");
  r = await call("/workspaces", {
    method: "POST",
    token,
    body: { name: "Sneaky Premium", plan_type: "premium" }, // NO payment anywhere
  });
  ok("POST with plan_type:premium still creates (within cap) → 201", r.status === 201, `got ${r.status}`);
  ok("workspace stored as FREE — server ignored client plan_type", r.data.workspace?.plan_type === "free", `got ${r.data?.workspace?.plan_type}`);
  if (r.status === 201) created.push(r.data.workspace);
  const sneaky = r.data.workspace;

  console.log("— [FIXED] Vector B: PATCH plan_type is not client-settable —");
  r = await call(`/workspaces/${sneaky?.id}`, { method: "PATCH", token, body: { plan_type: "premium" } });
  ok("PATCH plan_type alone → 400 (no patchable field)", r.status === 400, `got ${r.status}`);
  r = await call(`/workspaces/${sneaky?.id}`, { token });
  ok("plan_type unchanged after refused PATCH — no rewrite", r.data.workspace?.plan_type === "free", `got ${r.data?.workspace?.plan_type}`);
  r = await call(`/workspaces/${sneaky?.id}`, {
    method: "PATCH",
    token,
    body: { plan_type: "premium", name: "Renamed Sneaky" },
  });
  ok("PATCH mixing plan_type with a real change → 200", r.status === 200, `got ${r.status}`);
  ok("plan_type STILL free — silently ignored, never applied", r.data.workspace?.plan_type === "free", `got ${r.data?.workspace?.plan_type}`);

  console.log("— [CAP-INTACT] account-wide cap (default 10) counts ALL workspaces —");
  for (let i = 2; i <= 10; i++) {
    r = await call("/workspaces", { method: "POST", token, body: { name: `Client ${i}` } });
    ok(`workspace ${i} of 10 → 201`, r.status === 201, `got ${r.status}`);
    if (r.status === 201) created.push(r.data.workspace);
  }
  r = await call("/workspaces", { method: "POST", token, body: { name: "One Too Many" } });
  ok("11th workspace → 402 WORKSPACE_LIMIT", r.status === 402 && r.data.code === "WORKSPACE_LIMIT", `got ${r.status}`);
  r = await call("/workspaces", {
    method: "POST",
    token,
    body: { name: "Premium Still Blocked", plan_type: "premium" },
  });
  ok("11th attempt with plan_type:premium → still 402 (plan_type cannot bypass)", r.status === 402 && r.data.code === "WORKSPACE_LIMIT", `got ${r.status}`);
  r = await call("/workspaces", { token });
  ok("account owns exactly 10 workspaces at the cap", r.status === 200 && r.data.workspaces.length === 10, `got ${r.data?.workspaces?.length}`);

  console.log("— Cleanup —");
  for (const w of created) {
    r = await call(`/workspaces/${w.id}`, { method: "DELETE", token });
    ok(`delete ws ${w.id}`, r.status === 204, `got ${r.status}`);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
