const TOKEN_KEY = "switchboard_token";
const ACTIVE_WS_KEY = "switchboard_active_ws";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}
export function getStoredActiveWS() {
  const v = localStorage.getItem(ACTIVE_WS_KEY);
  return v ? Number(v) : null;
}
export function storeActiveWS(id) {
  if (id == null) localStorage.removeItem(ACTIVE_WS_KEY);
  else localStorage.setItem(ACTIVE_WS_KEY, String(id));
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || {};
  }
}

/**
 * REST wrapper. Injects the JWT, JSON-encodes bodies, and force-logs-out on a
 * stale token (401). Always throws ApiError so callers can react to `code`s
 * (e.g. WORKSPACE_LIMIT) and to `status` (402 paywall).
 */
export async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Phase 3: VITE_API_BASE points at the Render backend in production
  // (e.g. https://switchboard-api.onrender.com). Empty in local dev, where
  // the Vite proxy forwards /api to localhost:3001.
  const apiBase = import.meta.env.VITE_API_BASE ?? "";
  const res = await fetch(`${apiBase}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-json (e.g. 204 handled above, or empty) */
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}
