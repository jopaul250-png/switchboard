import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useWorkspaces } from "../context/WorkspaceContext.jsx";
import { useToast } from "./ui.jsx";

const fmt = (s) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");

/**
 * Floating trust-based time tracker (PLAN 1.6).
 * - Start/Pause toggles a ticking HH:MM:SS clock
 * - Stop → POST /time-logs (raw record) → server adds duration/3600 to
 *   workspace.hours_used → scope response patches the context, so the
 *   dashboard Scope Meter updates instantly, no refresh.
 * - Attribution is pinned to the workspace the session STARTED in —
 *   switching clients mid-session pauses the clock and keeps billing honest.
 */
export default function StopwatchWidget() {
  const { active, patchWorkspace } = useWorkspaces();
  const toast = useToast();
  const [desc, setDesc] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [session, setSession] = useState(null); // { wsId, wsName, startedAt }
  const [savedMsg, setSavedMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const savedTimer = useRef(null);

  useEffect(() => {
    if (running) {
      const id = setInterval(() => setElapsed((e) => e + 1), 1000);
      return () => clearInterval(id);
    }
  }, [running]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  /* P3: switching client workspaces auto-pauses the running clock. Elapsed
     time and attribution stay pinned to the workspace the session STARTED
     in; the user can resume or Stop & Log from anywhere. */
  useEffect(() => {
    setRunning((r) => (r && session && session.wsId !== active?.id ? false : r));
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  const startPause = () => {
    setError(null);
    if (!session) {
      setSession({ wsId: active.id, wsName: active.name, startedAt: new Date().toISOString() });
      setRunning(true);
    } else {
      setRunning((r) => !r); // pause / resume
    }
  };

  const stopAndSave = async () => {
    if (!session || busy) return;
    if (elapsed < 5) {
      setError("Session too short to log (min 5s) — discarded.");
      setElapsed(0);
      setRunning(false);
      setSession(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const seconds = Math.round(elapsed);
      const res = await api(`/workspaces/${session.wsId}/time-logs`, {
        method: "POST",
        body: {
          task_description: desc,
          duration_seconds: seconds,
          started_at: session.startedAt,
        },
      });
      // active increment → meter without page refresh
      patchWorkspace(session.wsId, {
        hours_used: res.scope.hours_used,
        contract_hours: res.scope.contract_hours,
      });
      setSavedMsg(`+${(seconds / 3600).toFixed(2)}h logged to ${session.wsName}`);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSavedMsg(null), 5000);
      toast.success(`+${(seconds / 3600).toFixed(2)}h logged to ${session.wsName}`, 4500);
      setElapsed(0);
      setRunning(false);
      setSession(null);
      setDesc("");
    } catch (err) {
      setError(err.message);
      toast.error(`Could not save the session — ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const away = session && session.wsId !== active?.id;

  return (
    <div className="absolute bottom-5 right-5 z-30 w-[19rem] rounded-2xl border border-slate-800 bg-slate-900/95 p-4 shadow-2xl backdrop-blur">
      {/* header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              running
                ? "bg-emerald-400 animate-pulse"
                : session
                  ? "bg-amber-400"
                  : "bg-slate-600"
            }`}
          />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Time Tracker
          </span>
        </div>
        {session ? (
          <span className="max-w-[8.5rem] truncate text-[10px] text-slate-500" title={session.wsName}>
            {away ? "⏸ belongs to " : "tracking "}
            {session.wsName}
          </span>
        ) : (
          <span className="truncate text-[10px] text-slate-500" title={active.name}>
            {active.name}
          </span>
        )}
      </div>

      {/* description input */}
      <input
        type="text"
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="What are you working on?"
        className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-indigo-500 disabled:opacity-50"
        disabled={Boolean(session) || busy}
      />

      {/* ticking clock */}
      <div
        className={`mt-3 text-center font-mono text-3xl font-bold tabular-nums tracking-wider ${
          running ? "text-emerald-300" : session ? "text-amber-300" : "text-slate-400"
        }`}
      >
        {fmt(elapsed)}
      </div>

      {/* controls */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={startPause}
          disabled={busy}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
            !session
              ? "bg-indigo-600 text-white hover:bg-indigo-500"
              : running
                ? "bg-amber-500/90 text-slate-950 hover:bg-amber-400"
                : "bg-emerald-600 text-white hover:bg-emerald-500"
          }`}
        >
          {!session ? "▶ Start" : running ? "⏸ Pause" : "▶ Resume"}
        </button>
        <button
          onClick={stopAndSave}
          disabled={!session || busy}
          className="flex-1 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-800 disabled:hover:text-rose-300"
        >
          ■ Stop & Log
        </button>
      </div>

      {(savedMsg || error) && (
        <p
          className={`mt-2 text-center text-[11px] font-semibold ${
            savedMsg ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {savedMsg || error}
        </p>
      )}
    </div>
  );
}
