// Phase 1.5 — PREMIUM BYPASS: VULNERABILITY REPRODUCTION (documentation only).
//
// NO FIX IS SHIPPED IN THIS PHASE. This file exists to prove, with a passing
// test, that the M3 free-tier cap is bypassable end-to-end today:
//
//   Vector A (creation-time):  POST /workspaces with plan_type:"premium"
//     → planLimits() explicitly skips the cap for premium creations
//       (middleware/planLimits.js: "premium creation unrestricted in v1"),
//       and NOTHING verifies any payment.
//   Vector B (flip-time):      PATCH /workspaces/:id { plan_type:"premium" }
//     → any authenticated owner can flip their workspace to premium for free,
//       which releases free slots (Trello semantics) and enables unlimited
//       workspace creation.
//
// Root cause: plan_type is CLIENT-AUTHORITATIVE. There is no billing
// integration, so "premium" is just a string the client may send at will.
//
// OWNER-DECIDED TARGET DESIGN (Phase 2+, NOT this phase):
//   1. Server IGNORES client-sent plan_type on POST/PATCH entirely.
//   2. ONE configurable workspace cap per account (env-driven, default 10).
//   3. The client Upgrade button becomes "coming soon" (no server contract).
//
// WHEN THE FIX LANDS, INVERT every assertion marked [VULNERABLE] below:
//   - POST with plan_type:"premium" must be created as FREE (cap applies) or 400.
//   - PATCH plan_type:"premium" must be refused (400/403) — plan is not
//     client-settable without billing.
//   - Creation beyond the configured cap must 402 regardless of any plan_type.
// The [CAP-INTACT] assertion below stays valid after the fix unchanged.

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

  console.log("— [CAP-INTACT] the free cap itself works —");
  r = await call("/workspaces", { method: "POST", token, body: { name: "Free 1" } });
  ok("free workspace 1 → 201", r.status === 201, `got ${r.status}`);
  const ws1 = r.data.workspace;
  r = await call("/workspaces", { method: "POST", token, body: { name: "Free 2" } });
  ok("free workspace 2 → 201", r.status === 201, `got ${r.status}`);
  const ws2 = r.data.workspace;
  r = await call("/workspaces", { method: "POST", token, body: { name: "Free 3" } });
  ok("free workspace 3 → 402 (cap enforced)", r.status === 402 && r.data.code === "WORKSPACE_LIMIT", `got ${r.status}`);

  console.log("— [VULNERABLE] Vector A: creation-time premium bypass —");
  r = await call("/workspaces", {
    method: "POST",
    token,
    body: { name: "Self-Served Premium", plan_type: "premium" }, // NO payment anywhere
  });
  ok("VULNERABLE: POST plan_type:premium skips the cap → 201", r.status === 201, `got ${r.status}`);
  const ws3 = r.data.workspace;
  ok("VULNERABLE: workspace stored as premium with zero billing", r.status === 201 && r.data.workspace?.plan_type === "premium", `got ${r.data?.workspace?.plan_type}`);

  console.log("— [VULNERABLE] Vector B: client-authoritative plan flip —");
  r = await call(`/workspaces/${ws1.id}`, { method: "PATCH", token, body: { plan_type: "premium" } });
  ok("VULNERABLE: PATCH flips free→premium with no payment → 200", r.status === 200 && r.data.workspace?.plan_type === "premium", `got ${r.status}`);

  console.log("— [VULNERABLE] compounding: released slots enable unlimited creation —");
  const created = [ws1, ws2, ws3];
  for (let i = 4; i <= 8; i++) {
    // keep flipping the oldest free workspace to premium so slots keep opening
    const stillFree = created.find((w) => w.plan_type !== "premium");
    if (stillFree) {
      await call(`/workspaces/${stillFree.id}`, { method: "PATCH", token, body: { plan_type: "premium" } });
      stillFree.plan_type = "premium";
    }
    r = await call("/workspaces", { method: "POST", token, body: { name: `Overflow ${i}` } });
    ok(`VULNERABLE: overflow workspace ${i} → 201 (beyond free cap)`, r.status === 201, `got ${r.status}`);
    if (r.status === 201) created.push(r.data.workspace);
  }

  r = await call("/workspaces", { token });
  ok("VULNERABLE: account now owns 8 workspaces on a never-paid plan", r.status === 200 && r.data.workspaces.length === 8, `got ${r.data?.workspaces?.length}`);

  console.log("— Cleanup —");
  for (const w of created) {
    r = await call(`/workspaces/${w.id}`, { method: "DELETE", token });
    ok(`delete ws ${w.id}`, r.status === 204, `got ${r.status}`);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  console.log("NOTE: this suite PASSES while the vulnerability exists. After the");
  console.log("Phase 2 fix (server ignores client plan_type + single cap), invert");
  console.log("every [VULNERABLE] assertion — they must then expect refusals.");
  process.exit(fail ? 1 : 0);
})();
