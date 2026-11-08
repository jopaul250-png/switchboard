import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useWorkspaces } from "../context/WorkspaceContext.jsx";
import ScopeMeter from "../components/ScopeMeter.jsx";
import { Button, Input, EmptyState, ConfirmModal, useToast } from "../components/ui.jsx";
import { Plus, ArrowLeft, ArrowRight, Trash, Check } from "../components/icons.jsx";

const COLUMNS = [
  { key: "todo", label: "To Do", dot: "bg-slate-500" },
  { key: "in_progress", label: "In Progress", dot: "bg-amber-400" },
  { key: "done", label: "Done", dot: "bg-emerald-400" },
];

export default function TasksPage() {
  const { active, patchWorkspace } = useWorkspaces();
  const toast = useToast();
  const [tasks, setTasks] = useState([]);
  const [form, setForm] = useState({ title: "", hours: "1", status: "todo" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // in-app deletion confirm (replaces native confirm())
  const [pendingDelete, setPendingDelete] = useState(null); // task object | null
  const [deleting, setDeleting] = useState(false);

  const fetchTasks = async () => {
    const d = await api(`/workspaces/${active.id}/tasks`);
    setTasks(d.tasks);
    syncScope(d.scope);
  };

  const syncScope = (scope) => {
    if (scope)
      patchWorkspace(active.id, { hours_used: scope.hours_used, contract_hours: scope.contract_hours });
  };

  useEffect(() => {
    if (!active) return;
    setTasks([]);
    fetchTasks().catch(() => {});
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* PATCH status — response feeds the Scope Meter for instant re-render */
  const move = async (task, dir) => {
    try {
      const order = ["todo", "in_progress", "done"];
      const next = order[order.indexOf(task.status) + dir];
      if (!next) return;
      const d = await api(`/workspaces/${active.id}/tasks/${task.id}`, {
        method: "PATCH",
        body: { status: next },
      });
      setTasks((l) => l.map((t) => (t.id === d.task.id ? d.task : t)));
      syncScope(d.scope);
    } catch (err) {
      toast.error(`Could not move "${task.title}" — ${err.message}`);
    }
  };

  /* In-app confirm (was native confirm()); P2: deleting still honest — task
     estimates never moved the meter, so nothing to subtract */
  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return; // duplicate-click guard
    const target = pendingDelete;
    setDeleting(true);
    try {
      await api(`/workspaces/${active.id}/tasks/${target.id}`, { method: "DELETE" });
      setTasks((l) => l.filter((t) => t.id !== target.id));
      setPendingDelete(null);
      toast.success(`Task "${target.title}" removed`);
    } catch (err) {
      setPendingDelete(null);
      toast.error(`Could not delete "${target.title}" — ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api(`/workspaces/${active.id}/tasks`, {
        method: "POST",
        body: {
          title: form.title,
          estimated_hours: Number(form.hours) || 1,
          status: form.status,
        },
      });
      setTasks((l) => [d.task, ...l]);
      syncScope(d.scope);
      setForm({ title: "", hours: "1", status: "todo" });
      toast.success("Task added to board");
    } catch (err) {
      setError(err.message);
      toast.error(`Could not add task — ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!active) return null;

  return (
    <div className="space-y-5">
      {/* Scope Meter guardrail at the top of the board */}
      <ScopeMeter hoursUsed={active.hours_used} contractHours={active.contract_hours} compact />

      {/* Quick add */}
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <Input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="New task — e.g. Schedule Nov newsletter"
          className="min-w-[220px] flex-1"
        />
        <div className="relative w-24">
          <input
            type="number"
            min="0"
            step="0.5"
            value={form.hours}
            onChange={(e) => setForm({ ...form, hours: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 pr-8 text-sm text-slate-100 outline-none focus:border-indigo-500"
            title="Estimated hours (fed to the Scope Meter when done)"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
            h
          </span>
        </div>
        <select
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 outline-none focus:border-indigo-500"
        >
          {COLUMNS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={busy}>
          <Plus className="h-4 w-4" /> Add
        </Button>
        {error && <ErrorText>{error}</ErrorText>}
      </form>

      {/* Board */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.key);
          return (
            <div
              key={col.key}
              className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/40 p-3"
            >
              <div className="flex items-center justify-between px-1 pb-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    {col.label}
                  </h3>
                </div>
                <span className="text-xs font-bold text-slate-600">{colTasks.length}</span>
              </div>

              <div className="min-h-[80px] flex-1 space-y-2">
                {colTasks.map((t) => (
                  <div
                    key={t.id}
                    className={`group rounded-xl border p-3 transition-colors ${
                      t.status === "done"
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : "border-slate-800 bg-slate-900 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm font-medium ${
                          t.status === "done" ? "text-slate-400 line-through" : "text-slate-200"
                        }`}
                      >
                        {t.title}
                      </p>
                      <button
                        onClick={() => setPendingDelete(t)}
                        className="rounded p-0.5 text-slate-700 hover:text-rose-400"
                        title="Delete"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-bold text-slate-400 ring-1 ring-slate-800">
                        {t.estimated_hours}h
                      </span>
                      <div className="flex items-center gap-1">
                        {t.status !== "todo" && (
                          <button
                            onClick={() => move(t, -1)}
                            className="rounded-md bg-slate-800/70 p-1 text-slate-400 hover:text-slate-200"
                            title="Move left"
                          >
                            <ArrowLeft className="h-3 w-3" />
                          </button>
                        )}
                        {t.status === "in_progress" && (
                          <button
                            onClick={() => move(t, +1)}
                            className="flex items-center gap-1 rounded-md bg-emerald-600/80 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-500"
                            title={`Done — adds ${t.estimated_hours}h to the meter`}
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        )}
                        {t.status === "todo" && (
                          <button
                            onClick={() => move(t, +1)}
                            className="rounded-md bg-slate-800/70 p-1 text-slate-400 hover:text-amber-300"
                            title="Start working"
                          >
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {colTasks.length === 0 && (
                  <p className="py-4 text-center text-[11px] text-slate-700">Nothing here</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {tasks.length === 0 && (
        <EmptyState
          title="Board is empty"
          subtitle="Add tasks with estimated hours — completing them feeds the Scope Meter at the top."
        />
      )}

      {pendingDelete && (
        <ConfirmModal
          open
          onClose={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
          tone="warning"
          title="Delete task?"
          message={`You are about to remove "${pendingDelete.title}" from the board. This cannot be undone.`}
          confirmLabel="Permanently Delete"
          busy={deleting}
        />
      )}
    </div>
  );
}

function ErrorText({ children }) {
  if (!children) return null;
  return <p className="w-full text-xs font-medium text-rose-400">{children}</p>;
}
