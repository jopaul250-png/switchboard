import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useWorkspaces } from "../context/WorkspaceContext.jsx";
import { Badge, ConfirmModal, useToast } from "./ui.jsx";
import { Clock, Trash } from "./icons.jsx";

const fmtDuration = (s) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");

const fmtStart = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};

/**
 * P4 — Time-log history (uses the existing GET + DELETE time-logs endpoints).
 * - Shows description, client workspace, start date/time, duration, delete.
 * - Deleting a log removes only its own actual hours: the DELETE response
 *   carries the freshly derived scope, which patches the meter instantly.
 */
export default function TimeLogHistory({ workspaceId, workspaceName }) {
  const { patchWorkspace } = useWorkspaces();
  const toast = useToast();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(null); // log object | null
  const [deleting, setDeleting] = useState(false);

  const fetchLogs = async () => {
    try {
      const d = await api(`/workspaces/${workspaceId}/time-logs`);
      setLogs(d.logs);
      setTotal(d.total_seconds);
    } catch {
      /* list errors surface silently; the widget state stays usable */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setLogs([]);
    if (!workspaceId) return;
    fetchLogs();
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return; // duplicate-click guard
    const target = pendingDelete;
    setDeleting(true);
    try {
      const res = await api(`/workspaces/${target.workspace_id}/time-logs/${target.id}`, {
        method: "DELETE",
      });
      setLogs((l) => l.filter((x) => x.id !== target.id));
      setTotal((t) => Math.max(0, t - target.duration_seconds));
      // meter honesty: scope is re-derived server-side after the delete
      if (res?.scope)
        patchWorkspace(target.workspace_id, {
          hours_used: res.scope.hours_used,
          contract_hours: res.scope.contract_hours,
          manual_hours: res.scope.manual_hours,
          tracked_hours: res.scope.tracked_hours,
        });
      setPendingDelete(null);
      toast.success(
        `Log "${target.task_description}" deleted — ${fmtDuration(target.duration_seconds)} removed from the meter`
      );
    } catch (err) {
      setPendingDelete(null);
      toast.error(`Could not delete the log — ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Tracked sessions history
          </span>
        </div>
        <Badge tone="indigo">
          {fmtDuration(total)} actual logged
        </Badge>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-slate-600">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="mt-3 text-xs text-slate-600">
          No tracked sessions yet — start the floating time tracker and stop it to record actual
          billable time.
        </p>
      ) : (
        <div className="mt-3 divide-y divide-slate-800/70">
          {logs.map((log) => (
            <div key={log.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-200">
                  {log.task_description}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-600">
                  {fmtStart(log.started_at)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400 ring-1 ring-slate-700">
                {log.workspace_name || workspaceName}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-emerald-300">
                {fmtDuration(log.duration_seconds)}
              </span>
              <button
                onClick={() => setPendingDelete(log)}
                className="shrink-0 rounded-lg p-1.5 text-slate-700 transition-colors hover:bg-slate-800 hover:text-rose-400"
                title="Delete log (removes its actual hours from the meter)"
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          open
          onClose={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
          tone="warning"
          title="Delete time log?"
          message={`You are about to permanently delete "${pendingDelete.task_description}" (${fmtDuration(pendingDelete.duration_seconds)}). Its actual hours will be removed from the Scope Meter.`}
          confirmLabel="Permanently Delete"
          busy={deleting}
        />
      )}
    </div>
  );
}
