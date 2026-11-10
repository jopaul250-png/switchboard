// Phase 1.3 — brute-force resistance + baseline security headers.
//
//  - Login is rate-limited per ACCOUNT (keyed by the submitted email, not
//    just per IP): the 6th failed attempt on the same email within the
//    window → 429, and the account stays locked for the window even with
//    the correct password. A different account from the same IP is
//    unaffected (per-account keying). Defaults: 5 attempts / 15 min
//    (RATE_LIMIT_LOGIN_ACCOUNT_MAX), 30 auth requests / 15 min per IP
//    (RATE_LIMIT_AUTH_IP_MAX) — the runner overrides the IP cap for the
//    shared test server; the account cap runs at its real default here.
//  - helmet() sets baseline security headers on every response (checked
//    on /api/health).
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
  return { status: res.status, data, headers: res.headers };
};

(async () => {
  const pw = "RateProbePassword1";
  const emailC = `rate-victim-${Date.now()}@devswitchboard.io`;
  const emailD = `rate-innocent-${Date.now()}@devswitchboard.io`;

  let r = await call("/auth/register", { method: "POST", body: { email: emailC, password: pw } });
  ok("setup: victim account registered", r.status === 201, `got ${r.status}`);

  console.log("— Per-account login lockout —");
  let saw429Early = false;
  for (let i = 1; i <= 5; i++) {
    r = await call("/auth/login", { method: "POST", body: { email: emailC, password: "definitely-wrong" } });
    if (r.status === 429) saw429Early = true;
  }
  ok("5 failed attempts → 401 (not yet locked)", r.status === 401 && !saw429Early, `got ${r.status} on 5th`);

  r = await call("/auth/login", { method: "POST", body: { email: emailC, password: "definitely-wrong" } });
  ok("6th failed attempt → 429 RATE_LIMITED", r.status === 429 && r.data.code === "RATE_LIMITED", `got ${r.status} ${JSON.stringify(r.data)}`);

  r = await call("/auth/login", { method: "POST", body: { email: emailC, password: pw } });
  ok("correct password while locked → still 429", r.status === 429 && r.data.code === "RATE_LIMITED", `got ${r.status}`);

  r = await call("/auth/register", { method: "POST", body: { email: emailD, password: pw } });
  ok("different account registered (IP not locked)", r.status === 201, `got ${r.status}`);
  r = await call("/auth/login", { method: "POST", body: { email: emailD, password: pw } });
  ok("different account logs in fine → 200 (per-email keying)", r.status === 200 && r.data.token, `got ${r.status}`);

  console.log("— Baseline security headers (helmet) —");
  const h = await call("/api/health");
  const get = (k) => h.headers.get(k) || "";
  ok("x-content-type-options: nosniff", get("x-content-type-options") === "nosniff", `got "${get("x-content-type-options")}"`);
  ok("cross-origin-resource-policy: cross-origin (Vercel client must keep working)", get("cross-origin-resource-policy") === "cross-origin", `got "${get("cross-origin-resource-policy")}"`);
  ok("content-security-policy present", get("content-security-policy").length > 0, "missing");

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
