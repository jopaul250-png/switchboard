import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useWorkspaces } from "../context/WorkspaceContext.jsx";
import { Button, Input, ConfirmModal, useToast } from "../components/ui.jsx";
import { Crown, Trash } from "../components/icons.jsx";

export default function SettingsPage() {
  const { active, patchWorkspace, load } = useWorkspaces();
  const toast = useToast();
  // P2: manual adjustments are recorded separately (hours_manual); tracked
  // actuals come from time_logs and are read-only here.
  const [form, setForm] = useState({ name: "", contract_hours: 40, hours_manual: 0 });
  const [trackedHours, setTrackedHours] = useState(0);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // in-app deletion confirm (replaces native confirm())
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setMsg(null);
    setError(null);
    if (active) {
      setForm({
        name: active.name,
        contract_hours: active.contract_hours,
        hours_manual: active.manual_hours ?? active.hours_manual ?? 0,
      });
      // derived: tracked actuals = meter total − manual adjustments
      setTrackedHours(
        Math.max(0, (active.tracked_hours ?? (active.hours_used || 0) - (active.hours_manual || 0)))
      );
    }
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  const applyScope = (scope) => {
    if (!scope) return;
    setTrackedHours(scope.tracked_hours ?? 0);
    patchWorkspace(active.id, {
      hours_used: scope.hours_used,
      contract_hours: scope.contract_hours,
      manual_hours: scope.manual_hours,
      tracked_hours: scope.tracked_hours,
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setBusy(true);
    try {
      const d = await api(`/workspaces/${active.id}`, {
        method: "PATCH",
        body: {
          name: form.name,
          contract_hours: Number(form.contract_hours),
          hours_manual: Number(form.hours_manual) || 0,
        },
      });
      patchWorkspace(active.id, d.workspace);
      applyScope(d.scope);
      setMsg("Saved.");
      toast.success("Workspace settings saved");
    } catch (err) {
      setError(err.message);
      toast.error(`Could not save settings — ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // Phase 2.4: plan_type is not client-settable (no billing integration) —
  // upgrade/downgrade controls are disabled until billing ships.
  const confirmDestroy = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api(`/workspaces/${active.id}`, { method: "DELETE" });
      const name = active.name;
      setPendingDelete(false);
      await load(); // refresh list; context auto-selects the next workspace
      toast.success(`Workspace "${name}" permanently deleted`);
    } catch (err) {
      setPendingDelete(false);
      toast.error(`Could not delete workspace — ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-lg font-extrabold text-slate-100">Workspace settings</h1>

      <form
        onSubmit={save}
        className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
      >
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
            Client name
          </label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
              Contract hours / month
            </label>
            <Input
              type="number"
              min="0"
              step="1"
              value={form.contract_hours}
              onChange={(e) => setForm({ ...form, contract_hours: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
              Manual hour adjustment
            </label>
            <Input
              type="number"
              min="0"
              step="0.5"
              value={form.hours_manual}
              onChange={(e) => setForm({ ...form, hours_manual: e.target.value })}
              title="Recorded separately — tracked actuals from the stopwatch always stay intact"
            />
          </div>
        </div>
        {/* P2 read-only reference: actual tracked time is owned by time_logs */}
        <p className="text-[11px] text-slate-500">
          Tracked actuals (stopwatch): <span className="font-bold text-slate-300">{trackedHours.toFixed(2)}h</span>{" "}
          — estimated task hours are forecasting only and never touch the meter.
        </p>
        {error && <p className="text-xs font-medium text-rose-400">{error}</p>}
        {msg && <p className="text-xs font-medium text-emerald-400">{msg}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </form>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
          Plan — {active.plan_type}
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Each account is limited to 10 client workspaces. Premium upgrades are coming
          soon — plan changes are disabled until billing ships.
        </p>
        <div className="mt-3 flex gap-2">
          <Button variant="success" disabled title="Premium billing is not available yet">
            <Crown className="h-4 w-4" /> Upgrade to Premium (coming soon)
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-rose-400">Danger zone</h2>
        <p className="mt-2 text-sm text-slate-400">
          Deleting removes all SOPs, credentials, tasks, and pulse data for{" "}
          <span className="font-semibold text-slate-200">{active.name}</span>.
        </p>
        <Button variant="danger" className="mt-3" onClick={() => setPendingDelete(true)}>
          <Trash className="h-4 w-4" /> Delete workspace
        </Button>
      </div>

      {pendingDelete && (
        <ConfirmModal
          open
          onClose={() => setPendingDelete(false)}
          onConfirm={confirmDestroy}
          tone="warning"
          title="Delete workspace?"
          message={`You are about to permanently delete "${active.name}" and all of its data (SOPs, credentials, tasks, pulse, time logs). This cannot be undone.`}
          confirmLabel="Permanently Delete"
          busy={deleting}
        />
      )}
    </div>
  );
}
