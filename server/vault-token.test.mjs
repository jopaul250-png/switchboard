// Phase 1.1 — server-enforced vault token.
//
// The credentials vault re-auth gate must be enforced SERVER-side, not just
// client-side: POST /auth/verify-password issues a short-lived, user-bound
// vault token, and POST /credentials/:id/reveal requires it via the
// X-Vault-Token header. Rejections are 403 {code:"VAULT_LOCKED"}.
//
// Covered here:
//   - no token            → 403 VAULT_LOCKED
//   - garbage token       → 403 VAULT_LOCKED
//   - the LOGIN JWT sent as the vault token → 403 (distinct `purpose` claim)
//   - another user's vault token → 403 (token is bound to its user id)
//   - an expired vault token     → 403 (short TTL, default 5 min)
//   - correct password → 200 + vault_token; token then works → 200 plaintext
const BASE = process.env.SMOKE_API_BASE || "http://localhost:3001/api";
import jwt from "jsonwebtoken";

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

(async () => {
  const pw = "VaultProbePassword1";
  const emailA = `vault-owner-${Date.now()}@devswitchboard.io`;
  const emailB = `vault-rival-${Date.now()}@devswitchboard.io`;

  console.log("— Setup —");
  let r = await call("/auth/register", { method: "POST", body: { email: emailA, password: pw } });
  ok("A registered", r.status === 201 && r.data.token, `got ${r.status}`);
  const tokenA = r.data.token;
  const aId = (await call("/auth/me", { token: tokenA })).data.user.id;

  r = await call("/auth/register", { method: "POST", body: { email: emailB, password: pw } });
  ok("B registered", r.status === 201 && r.data.token, `got ${r.status}`);
  const tokenB = r.data.token;

  r = await call("/workspaces", { method: "POST", token: tokenA, body: { name: "Vault Probe WS" } });
  ok("workspace created", r.status === 201, `got ${r.status}`);
  const wsId = r.data.workspace.id;

  r = await call(`/workspaces/${wsId}/credentials`, {
    method: "POST", token: tokenA,
    body: { account_name: "Vault Probe", username: "probe", encrypted_password_or_token: "VAULT-PLAINTEXT-PROBE" },
  });
  ok("credential created", r.status === 201, `got ${r.status}`);
  const credId = r.data.credential.id;

  console.log("— Vault gate denies every non-valid token —");
  r = await call(`/workspaces/${wsId}/credentials/${credId}/reveal`, { method: "POST", token: tokenA });
  ok("no X-Vault-Token → 403 VAULT_LOCKED", r.status === 403 && r.data.code === "VAULT_LOCKED", `got ${r.status} ${JSON.stringify(r.data)}`);
  ok("denial leaks no plaintext", !JSON.stringify(r.data).includes("VAULT-PLAINTEXT-PROBE"));

  r = await call(`/workspaces/${wsId}/credentials/${credId}/reveal`, {
    method: "POST", token: tokenA, headers: { "X-Vault-Token": "garbage.token.value" },
  });
  ok("garbage token → 403 VAULT_LOCKED", r.status === 403 && r.data.code === "VAULT_LOCKED", `got ${r.status}`);

  r = await call(`/workspaces/${wsId}/credentials/${credId}/reveal`, {
    method: "POST", token: tokenA, headers: { "X-Vault-Token": tokenA }, // the login JWT, wrong purpose
  });
  ok("login JWT as vault token → 403 (purpose mismatch)", r.status === 403 && r.data.code === "VAULT_LOCKED", `got ${r.status}`);

  console.log("— Token issuance & binding —");
  r = await call("/auth/verify-password", { method: "POST", body: { password: pw }, token: tokenA });
  ok("verify-password 200 + vault_token issued", r.status === 200 && typeof r.data.vault_token === "string" && r.data.vault_token.length > 20, `got ${r.status}`);
  const vaultA = r.data.vault_token;

  r = await call("/auth/verify-password", { method: "POST", body: { password: pw }, token: tokenB });
  ok("B's verify-password 200", r.status === 200 && typeof r.data.vault_token === "string", `got ${r.status}`);
  const vaultB = r.data.vault_token;

  r = await call("/auth/verify-password", { method: "POST", body: { password: "wrong-password" }, token: tokenA });
  ok("wrong password → 401 and no token", r.status === 401 && !r.data?.vault_token, `got ${r.status}`);
  r = await call("/auth/verify-password", { method: "POST", body: { password: pw } });
  ok("verify-password requires auth → 401", r.status === 401);

  r = await call(`/workspaces/${wsId}/credentials/${credId}/reveal`, {
    method: "POST", token: tokenA, headers: { "X-Vault-Token": vaultB }, // valid signature, minted for B
  });
  ok("another user's vault token → 403", r.status === 403 && r.data.code === "VAULT_LOCKED", `got ${r.status}`);

  // Expired but correctly signed vault token (test-only forging with the
  // runner-provided TEST secret — same secret the server booted with).
  const expiredToken = jwt.sign({ id: aId, purpose: "vault" }, process.env.JWT_SECRET, { expiresIn: "-10s" });
  r = await call(`/workspaces/${wsId}/credentials/${credId}/reveal`, {
    method: "POST", token: tokenA, headers: { "X-Vault-Token": expiredToken },
  });
  ok("expired vault token → 403", r.status === 403 && r.data.code === "VAULT_LOCKED", `got ${r.status}`);

  console.log("— Happy path —");
  r = await call(`/workspaces/${wsId}/credentials/${credId}/reveal`, {
    method: "POST", token: tokenA, headers: { "X-Vault-Token": vaultA },
  });
  ok("valid vault token → 200 plaintext", r.status === 200 && r.data.plaintext === "VAULT-PLAINTEXT-PROBE", `got ${r.status}`);

  // Cleanup
  await call(`/workspaces/${wsId}`, { method: "DELETE", token: tokenA });

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
