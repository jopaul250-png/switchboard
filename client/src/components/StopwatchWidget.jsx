import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useWorkspaces } from "../context/WorkspaceContext.jsx";
import { useToast } from "./ui.jsx";
import {
  loadTimer,
  saveTimer,
  discardTimer,
  startTimer,
  pauseTimer,
  resumeTimer,
  elapsedSeconds,
} from "../lib/timer.js";

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
 *
 * Phase 2.2 — the session survives refresh and tab closure:
 * - the START TIMESTAMP (not a ticking counter) is persisted per workspace
 *   in localStorage (one slot = one active timer);
 * - elapsed is always COMPUTED from Date.now() (no drift, no lost counter);
 * - on load a persisted session offers RESUME or DISCARD;
 * - a session that was RUNNING when the tab closed keeps accruing wall time
 *   (trust-based model) — the prompt shows the true elapsed so resuming is
 *   an informed choice, and Discard drops the whole session.
 */
export default function StopwatchWidget() {
  const { active, patchWorkspace } = useWorkspaces();
  const toast = useToast();
  const [desc, setDesc] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [session, setSession] = useState(null); // persisted shape — see lib/timer.js
  const [prompt, setPrompt] = useState(false); // resume-or-discard pending
  const [savedMsg, setSavedMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const savedTimer = useRef(null);

  const running = Boolean(session?.running);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  /* Phase 2.2: on load, offer to resume or discard a persisted session. */
  useEffect(() => {
    const found = loadTimer(window.localStorage);
    if (!found) return;
    setSession(found);
    setDesc(found.desc || "");
    setElapsed(elapsedSeconds(found));
    setPrompt(true);
  }, []);

  /* Ticking display — recomputed from Date.now() each second (never +1). */
  useEffect(() => {
    if (!session || !running) return;
    const id = setInterval(() => setElapsed(elapsedSeconds(session)), 1000);
    return () => clearInterval(id);
  }, [session, running]);

  /* P3: switching client workspaces auto-pauses the running clock. Elapsed
     time and attribution stay pinned to the workspace the session STARTED
     in; the pause is persisted so it survives refresh. */
  useEffect(() => {
    if (!session || !running || session.wsId === active?.id) return;
    const paused = pauseTimer(session);
    saveTimer(window.localStorage, paused);
    setSession(paused);
    setElapsed(paused.accumulated);
  }, [active?.id, session, running]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  const startPause = () => {
    if (prompt || busy) return;
    setError(null);
    const next = !session
      ? startTimer({ wsId: active.id, wsName: active.name, desc: desc.trim() })
      : running
        ? pauseTimer(session)
        : resumeTimer(session);
    setSession(next);
    setElapsed(elapsedSeconds(next));
    saveTimer(window.localStorage, next);
  };

  /* Prompt actions — resume banks any wall time since the save (for a
     session that was running) and continues; discard drops everything. */
  const resumePersisted = () => {
    const now = Date.now();
    const banked = session.running ? pauseTimer(session, now) : session;
    const next = resumeTimer(banked, now);
    setSession(next);
    setElapsed(elapsedSeconds(next, now));
    saveTimer(window.localStorage, next);
    setPrompt(false);
  };

  const discardPersisted = () => {
    discardTimer(window.localStorage);
    setSession(null);
    setElapsed(0);
    setDesc("");
    setPrompt(false);
  };

  const stopAndSave = async () => {
    if (!session || busy || prompt) return;
    const seconds = Math.round(elapsedSeconds(session));
    if (seconds < 5) {
      setError("Session too short to log (min 5s) — discarded.");
      discardTimer(window.localStorage);
      setElapsed(0);
      setSession(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/workspaces/${session.wsId}/time-logs`, {
        method: "POST",
        body: {
          task_description: session.desc,
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
      discardTimer(window.localStorage);
      setElapsed(0);
      setSession(null);
      setDesc("");
    } catch (err) {
      setError(err.message);
      toast.error(`Could not save the session — ${err.message}`);
      // session stays in state AND storage — a refresh keeps it recoverable
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
        disabled={Boolean(session) || busy || prompt}
      />

      {/* ticking clock */}
      <div
        className={`mt-3 text-center font-mono text-3xl font-bold tabular-nums tracking-wider ${
          running ? "text-emerald-300" : session ? "text-amber-300" : "text-slate-400"
        }`}
      >
        {fmt(elapsed)}
      </div>

      {/* resume-or-discard prompt (persisted session found on load) */}
      {prompt && session && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-300">
            Unsaved session found
          </p>
          <p className="mt-1 truncate text-[11px] text-slate-300" title={session.desc || session.wsName}>
            {session.desc || "Untitled session"} · {session.wsName}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={resumePersisted}
              className="flex-1 rounded-md bg-emerald-600 px-2 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500"
            >
              Resume
            </button>
            <button
              onClick={discardPersisted}
              className="flex-1 rounded-md bg-slate-800 px-2 py-1.5 text-[11px] font-bold text-rose-300 transition-colors hover:bg-rose-600 hover:text-white"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* controls */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={startPause}
          disabled={busy || prompt}
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
          disabled={!session || busy || prompt}
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
