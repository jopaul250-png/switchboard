import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useWorkspaces, dotColor } from "../context/WorkspaceContext.jsx";
import ScopeMeter from "../components/ScopeMeter.jsx";
import PulseWidget from "../components/PulseWidget.jsx";
import TimeLogHistory from "../components/TimeLogHistory.jsx";
import { EmptyState } from "../components/ui.jsx";
import { Doc, Key, Check, Clock, Spark } from "../components/icons.jsx";

export default function Dashboard() {
  const { active, load, patchWorkspace } = useWorkspaces();
  const [tasks, setTasks] = useState([]);
  const [sopCount, setSopCount] = useState(0);
  const [credCount, setCredCount] = useState(0);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [quickTask, setQuickTask] = useState({ title: "", hours: "1" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);

  // refresh sidebar pulse badges on dashboard visit
  useEffect(() => {
    if (active) load().catch(() => {});
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoadingTasks(true);
    Promise.all([
      api(`/workspaces/${active.id}/tasks`),
      api(`/workspaces/${active.id}/sops`),
      api(`/workspaces/${active.id}/credentials`),
    ])
      .then(([t, s, c]) => {
        if (!alive) return;
        setTasks(t.tasks);
        setSopCount(s.sops.length);
        setCredCount(c.credentials.length);
      })
      .finally(() => alive && setLoadingTasks(false));
    return () => {
      alive = false;
    };
  }, [active?.id, active?.hours_used]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  /* Quick task creation, right on the dashboard — no board switch needed */
  const addTask = async (e) => {
    e?.preventDefault?.();
    if (!quickTask.title.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const d = await api(`/workspaces/${active.id}/tasks`, {
        method: "POST",
        body: {
          title: quickTask.title,
          estimated_hours: Number(quickTask.hours) || 1,
          status: "todo",
        },
      });
      setTasks((l) => [d.task, ...l]);
      if (d.scope)
        patchWorkspace(active.id, {
          hours_used: d.scope.hours_used,
          contract_hours: d.scope.contract_hours,
        });
      setQuickTask({ title: "", hours: quickTask.hours });
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");

  const Stat = ({ icon, label, value, tone }) => (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <p className={`mt-2 text-3xl font-extrabold ${tone || "text-slate-100"}`}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className={`h-3 w-3 rounded-full ${dotColor(active)}`} />
        <h1 className="text-xl font-extrabold tracking-tight">
          {active.name}
          <span className="ml-2 align-middle text-xs font-semibold text-slate-500">
            {active.plan_type === "premium" ? "★ Premium" : "Free"}
          </span>
        </h1>
      </div>

      {/* Scope Guardrail */}
      <ScopeMeter hoursUsed={active.hours_used} contractHours={active.contract_hours} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          icon={<Spark className="h-3.5 w-3.5" />}
          label="Open tasks"
          value={loadingTasks ? "—" : open.length}
        />
        <Stat
          icon={<Check className="h-3.5 w-3.5" />}
          label="Completed"
          value={loadingTasks ? "—" : done.length}
          tone="text-emerald-400"
        />
        <Stat
          icon={<Doc className="h-3.5 w-3.5" />}
          label="SOPs & Brand docs"
          value={sopCount}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Pulse widget gets its own column */}
        <PulseWidget workspaceId={active.id} />

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Up next
            </span>
          </div>

          {/* Quick task creation input */}
          <form onSubmit={addTask} className="mt-3 flex gap-2">
            <input
              type="text"
              value={quickTask.title}
              onChange={(e) => setQuickTask({ ...quickTask, title: e.target.value })}
              placeholder="Add a task without leaving the dashboard…"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            <div className="relative w-20 shrink-0">
              <input
                type="number"
                min="0"
                step="0.5"
                value={quickTask.hours}
                onChange={(e) => setQuickTask({ ...quickTask, hours: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-7 text-sm text-slate-100 outline-none focus:border-indigo-500"
                title="Estimated hours (feeds the Scope Meter when completed)"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                h
              </span>
            </div>
            <button
              type="submit"
              disabled={adding || !quickTask.title.trim()}
              className="shrink-0 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adding ? "…" : "Add"}
            </button>
          </form>
          {addError && <p className="mt-1.5 text-xs font-medium text-rose-400">{addError}</p>}
          {(loadingTasks ? [] : open).slice(0, 5).map((t) => (
            <div
              key={t.id}
              className="mt-2 flex items-center justify-between rounded-xl bg-slate-950/60 px-3 py-2 ring-1 ring-slate-800"
            >
              <span className="truncate text-sm text-slate-300">{t.title}</span>
              <span className="ml-2 shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                {t.estimated_hours}h
              </span>
            </div>
          ))}
          {loadingTasks && <p className="mt-3 text-xs text-slate-600">Loading…</p>}
          {!loadingTasks && open.length === 0 && (
            <p className="mt-3 text-xs text-slate-600">
              Inbox zero. All current tasks are done. 🎉
            </p>
          )}
        </div>
      </div>

      {/* P4: raw tracked-session history + per-log delete (meter stays honest) */}
      <TimeLogHistory workspaceId={active.id} workspaceName={active.name} />

      {/* quiet reference so KPI exists even before credential page visited */}
      <p className="text-center text-[10px] text-slate-700">
        {credCount} encrypted credential{credCount === 1 ? "" : "s"} stored in this workspace's locker
      </p>
    </div>
  );
}
