import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { useWorkspaces } from "../context/WorkspaceContext.jsx";
import { Button } from "./ui.jsx";
import { Bell, Spark } from "./icons.jsx";

const CHANNEL_STYLE = {
  Slack: { emoji: "💬", tone: "text-violet-300" },
  Email: { emoji: "✉️", tone: "text-sky-300" },
  WhatsApp: { emoji: "📱", tone: "text-emerald-300" },
};

/**
 * Webhook "Pulse" widget — aggregates simulated message counters from the
 * Slack / Email / WhatsApp notification queues, with one-click Clear Feed.
 */
export default function PulseWidget({ workspaceId }) {
  const { patchWorkspace } = useWorkspaces();
  const [pulse, setPulse] = useState({ feeds: [], total_unread: 0 });
  const [busy, setBusy] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);

  const fetchPulse = useCallback(async () => {
    const d = await api(`/workspaces/${workspaceId}/pulse`);
    setPulse(d);
    patchWorkspace(workspaceId, { pulse_unread: d.total_unread });
    return d;
  }, [workspaceId, patchWorkspace]);

  useEffect(() => {
    setPulse({ feeds: [], total_unread: 0 });
    fetchPulse().catch(() => {});
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const simulate = async () => {
    setBusy(true);
    try {
      const d = await api(`/workspaces/${workspaceId}/pulse/simulate`, { method: "POST" });
      setPulse(d);
      patchWorkspace(workspaceId, { pulse_unread: d.total_unread });
      setLastMessage(d.simulated);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const d = await api(`/workspaces/${workspaceId}/pulse/clear`, { method: "POST" });
      setPulse(d);
      patchWorkspace(workspaceId, { pulse_unread: d.total_unread });
      setLastMessage(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-indigo-300" />
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Webhook Pulse
          </span>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${
            pulse.total_unread > 0
              ? "bg-rose-500 text-white"
              : "bg-slate-800 text-slate-400"
          }`}
        >
          {pulse.total_unread} unread
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {pulse.feeds.map((f) => {
          const style = CHANNEL_STYLE[f.channel] || {};
          return (
            <div
              key={f.channel}
              className="flex items-center justify-between rounded-xl bg-slate-950/60 px-3 py-2 ring-1 ring-slate-800"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base">{style.emoji}</span>
                <div>
                  <span className={`text-xs font-bold ${style.tone}`}>{f.channel}</span>
                  {f.last_message && (
                    <p className="truncate text-[10px] text-slate-500">{f.last_message}</p>
                  )}
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  f.unread_count > 0 ? "bg-indigo-500/20 text-indigo-300" : "text-slate-600"
                }`}
              >
                {f.unread_count}
              </span>
            </div>
          );
        })}
        {lastMessage && (
          <p className="pt-1 text-[10px] italic text-slate-600">
            Last webhook: {lastMessage.count}× {lastMessage.channel} — "{lastMessage.message}"
          </p>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <Button size="sm" variant="secondary" onClick={simulate} disabled={busy}>
          <Spark className="h-3 w-3" /> Simulate incoming
        </Button>
        <Button size="sm" onClick={clear} disabled={busy}>
          Clear Feed
        </Button>
      </div>
    </div>
  );
}
