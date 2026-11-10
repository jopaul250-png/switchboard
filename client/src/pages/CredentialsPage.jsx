import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useWorkspaces } from "../context/WorkspaceContext.jsx";
import { Badge, Button, Input, EmptyState, ErrorText, Modal, ConfirmModal, useToast } from "../components/ui.jsx";
import { Key, Eye, EyeOff, Copy, Trash, Plus } from "../components/icons.jsx";

const MASK = "••••••••";
const REVEAL_WINDOW_MS = 10_000;
const IDLE_LOCK_MS = 2 * 60 * 1000; // 2 minutes

export default function CredentialsPage() {
  const { active } = useWorkspaces();
  const toast = useToast();
  const [creds, setCreds] = useState([]);
  const [revealed, setRevealed] = useState({}); // id -> { text, left }
  const [copied, setCopied] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState(null);
  const timers = useRef({});
  // in-app deletion confirm (replaces native confirm())
  const [pendingDelete, setPendingDelete] = useState(null); // cred object | null
  const [deleting, setDeleting] = useState(false);

  /* ---------------- Absolute privacy gate state ---------------- */
  const [locked, setLocked] = useState(true); // locked on every page entry
  const [pw, setPw] = useState("");
  const [checking, setChecking] = useState(false);
  const [gateError, setGateError] = useState(null);
  const lastActivity = useRef(Date.now());

  /* Re-lock when the workspace context changes (switching clients) */
  useEffect(() => {
    if (!active) return;
    setLocked(true);
    setPw("");
    setGateError(null);
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Lock instantly on leaving the page context (window blur / tab hidden) */
  useEffect(() => {
    if (locked) return;
    const relock = () => setLocked(true);
    const onVisibility = () => {
      if (document.hidden) relock();
    };
    window.addEventListener("blur", relock);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", relock);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [locked]);

  /* Idle listener: 2 minutes of inactivity re-locks the vault */
  useEffect(() => {
    if (locked) return;
    const bump = () => {
      lastActivity.current = Date.now();
    };
    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_LOCK_MS) setLocked(true);
    }, 5000);
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      clearInterval(t);
    };
  }, [locked]);

  const fetchCreds = () =>
    api(`/workspaces/${active.id}/credentials`)
      .then((d) => setCreds(d.credentials))
      .catch(() => {});

  useEffect(() => {
    if (!active) return;
    setRevealed({});
    fetchCreds();
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------- Re-auth gate: verifies main account password, keeps JWT ------- */
  const unlock = async (e) => {
    e?.preventDefault?.();
    if (checking || !pw) return;
    setChecking(true);
    setGateError(null);
    try {
      await api("/auth/verify-password", { method: "POST", body: { password: pw } });
      setLocked(false);
      setPw("");
      lastActivity.current = Date.now();
    } catch (err) {
      setGateError(err.message);
    } finally {
      setChecking(false);
    }
  };

  /* ------- the dedicated decryption route, surfaced via "Reveal" ------- */
  const reveal = async (cred) => {
    try {
      const d = await api(`/workspaces/${active.id}/credentials/${cred.id}/reveal`, {
        method: "POST",
      });
      const deadline = Date.now() + REVEAL_WINDOW_MS;
      const tick = setInterval(() => {
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        setRevealed((r) => ({ ...r, [cred.id]: { text: d.plaintext, left } }));
        if (left === 0) clearInterval(tick); // auto-remask
      }, 250);
      timers.current[cred.id] = tick;
      setRevealed((r) => ({ ...r, [cred.id]: { text: d.plaintext, left: 10 } }));
    } catch (err) {
      setError(err.message);
    }
  };

  const hide = (id) => {
    clearInterval(timers.current[id]);
    setRevealed((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });
  };

  const copy = async (cred) => {
    const entry = revealed[cred.id];
    if (!entry) return;
    await navigator.clipboard.writeText(entry.text);
    setCopied(cred.id);
    setTimeout(() => setCopied(null), 1500);
  };

  /* In-app confirm + toasts (was native confirm()) */
  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return; // duplicate-click guard
    const target = pendingDelete;
    setDeleting(true);
    try {
      await api(`/workspaces/${active.id}/credentials/${target.id}`, { method: "DELETE" });
      hide(target.id);
      setCreds((l) => l.filter((c) => c.id !== target.id));
      setPendingDelete(null);
      toast.success(`Credential "${target.account_name}" deleted`);
    } catch (err) {
      setPendingDelete(null);
      toast.error(`Could not delete "${target.account_name}" — ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  if (!active) return null;

  const isLocked = locked;

  return (
    <div className="relative">
      {/* ---------------- gated content ---------------- */}
      <div
        className={`space-y-4 transition-[filter] duration-200 ${
          isLocked ? "pointer-events-none select-none blur-sm" : ""
        }`}
        aria-hidden={isLocked}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-slate-400">
            <Key className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-widest">
              Encrypted with AES-256-GCM — values reveal for 10s only
            </span>
          </div>
          <Button
            onClick={() => {
              setError(null);
              setAddOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Add secret
          </Button>
        </div>
        {error && <ErrorText>{error}</ErrorText>}

        {creds.length === 0 ? (
          <EmptyState
            icon={<Key className="h-8 w-8 text-slate-600" />}
            title="The locker is empty"
            subtitle="Store client logins and API tokens here. They are encrypted at rest and always render masked."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {creds.map((c) => {
              const entry = revealed[c.id];
              // API timestamps are canonical ISO 8601 UTC (Phase 0.2) — parse directly.
              const dead = new Date(c.created_at).toLocaleDateString();
              return (
                <div
                  key={c.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-700"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-bold text-slate-200">{c.account_name}</h3>
                      {c.username && (
                        <p className="truncate text-xs text-slate-500">@{c.username}</p>
                      )}
                    </div>
                    <button
                      onClick={() => setPendingDelete(c)}
                      className="rounded-lg p-1.5 text-slate-700 hover:bg-slate-800 hover:text-rose-400"
                      title="Delete"
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 ring-1 ring-slate-800">
                    <code className="min-w-0 flex-1 truncate font-mono text-sm text-emerald-300">
                      {entry?.left > 0 ? (
                        entry.text
                      ) : (
                        <span className="tracking-widest text-slate-500">{MASK}</span>
                      )}
                    </code>
                    {entry?.left > 0 && (
                      <button
                        onClick={() => copy(c)}
                        className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                        title={copied === c.id ? "Copied!" : "Copy"}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => (entry?.left > 0 ? hide(c.id) : reveal(c))}
                      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-colors ${
                        entry?.left > 0
                          ? "bg-indigo-500/20 text-indigo-300"
                          : "text-slate-500 hover:bg-slate-800 hover:text-indigo-300"
                      }`}
                    >
                      {entry?.left > 0 ? (
                        <>
                          <EyeOff className="h-3 w-3" /> hide ({entry.left}s)
                        </>
                      ) : (
                        <>
                          <Eye className="h-3 w-3" /> Reveal
                        </>
                      )}
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <Badge tone="slate">{dead}</Badge>
                    {copied === c.id && (
                      <span className="text-[10px] font-semibold text-emerald-400">
                        ✓ Copied to clipboard
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------- privacy gate overlay ---------------- */}
      {isLocked && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-slate-950/70 backdrop-blur-sm">
          <form
            onSubmit={unlock}
            className="w-80 rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl"
          >
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/40">
              <Key className="h-6 w-6" />
            </div>
            <h3 className="mt-3 text-sm font-extrabold text-slate-100">Vault locked</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Enter your main Switchboard password to access
              <span className="font-semibold text-slate-300"> {active.name}</span>'s secrets.
            </p>
            <Input
              autoFocus
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Account password"
              className="mt-4 text-center"
              autoComplete="current-password"
            />
            {gateError && <ErrorText>{gateError}</ErrorText>}
            <Button type="submit" className="mt-4 w-full" disabled={checking || !pw}>
              {checking ? "Verifying…" : "Unlock vault"}
            </Button>
            <p className="mt-3 text-[10px] text-slate-600">
              Re-locks on workspace switch, tab change, or 2 min idle — session stays active.
            </p>
          </form>
        </div>
      )}

      <AddCredentialModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreate={async (payload) => {
          await api(`/workspaces/${active.id}/credentials`, { method: "POST", body: payload });
          fetchCreds();
          toast.success(`"${payload.account_name}" stored in the locker (AES-256-GCM)`);
        }}
      />

      {pendingDelete && (
        <ConfirmModal
          open
          onClose={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
          tone="warning"
          title="Delete credential?"
          message={`You are about to permanently delete "${pendingDelete.account_name}" from the vault. The encrypted value cannot be recovered.`}
          confirmLabel="Permanently Delete"
          busy={deleting}
        />
      )}
    </div>
  );
}

function AddCredentialModal({ open, onClose, onCreate }) {
  const [form, setForm] = useState({ account_name: "", username: "", secret: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm({ account_name: "", username: "", secret: "" });
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // API expects the secret under encrypted_password_or_token (never echoes it back)
      await onCreate({
        account_name: form.account_name,
        username: form.username || null,
        encrypted_password_or_token: form.secret,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add credential to the locker">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
            Account label
          </label>
          <Input
            autoFocus
            required
            value={form.account_name}
            onChange={(e) => setForm({ ...form, account_name: e.target.value })}
            placeholder="e.g. Summit Mailchimp Admin"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
            Username / email (optional)
          </label>
          <Input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="ops@summit.co"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
            Password or API token
          </label>
          <Input
            type="password"
            required
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            placeholder="Encrypted before it ever touches the database"
          />
        </div>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Encrypting…" : "Save to locker"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
