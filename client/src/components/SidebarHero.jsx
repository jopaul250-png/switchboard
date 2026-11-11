import { useWorkspaces, dotColor } from "../context/WorkspaceContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { Plus, Crown } from "./icons.jsx";
import BrandLogo from "./BrandLogo.jsx";
import { Badge } from "./ui.jsx";

/**
 * The hero feature: persistent multi-tenant client switcher.
 * - colored status dot per client (visual anchoring for fast scanning)
 * - live unread badges from pulse_feeds totals
 * - free-tier tracker + upgrade CTA pinned at the bottom
 */
export default function SidebarHero() {
  const {
    workspaces,
    active,
    activeId,
    switchWorkspace,
    used,
    workspaceCap,
    setCreateOpen,
  } = useWorkspaces();
  const { user, logout } = useAuth();

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900/80">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-950/50">
          <BrandLogo className="h-6 w-6 text-white" glow />
        </div>
        <div>
          <h1 className="text-sm font-extrabold tracking-tight text-slate-100">Switchboard</h1>
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-500">
            Unified Client Hub
          </p>
        </div>
      </div>

      {/* Switcher */}
      <div className="flex-1 overflow-y-auto px-3">
        <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Clients
        </p>
        <nav className="space-y-1">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => switchWorkspace(ws.id)}
              className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                ws.id === activeId
                  ? "bg-slate-800 text-slate-100 ring-1 ring-indigo-500/40"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColor(ws)} ${ws.id === activeId ? "shadow-[0_0_8px_currentColor]" : ""}`} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{ws.name}</span>
              {ws.plan_type === "premium" && (
                <Badge tone="amber" className="px-1.5">
                  <Crown className="h-2.5 w-2.5" /> Pro
                </Badge>
              )}
              {ws.pulse_unread > 0 && (
                <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {ws.pulse_unread}
                </span>
              )}
            </button>
          ))}
          {workspaces.length === 0 && (
            <p className="px-3 py-4 text-xs text-slate-600">No clients yet.</p>
          )}
        </nav>

        <button
          onClick={() => setCreateOpen(true)}
          className="mt-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:border-indigo-500/60 hover:bg-indigo-500/5 hover:text-indigo-300"
        >
          <Plus className="h-4 w-4" /> New Workspace
        </button>
      </div>

      {/* Workspace tracker + upgrade CTA (Phase 2.4: coming soon) */}
      <div className="m-3 rounded-2xl border border-slate-800 bg-slate-850 bg-slate-800/40 p-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Free Plan
          </span>
          <span
            className={`text-xs font-bold ${used >= workspaceCap ? "text-rose-400" : "text-emerald-400"}`}
          >
            Workspaces Used: {used}/{workspaceCap}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-900">
          <div
            className={`h-full rounded-full transition-all duration-500 ${used >= workspaceCap ? "bg-rose-500" : "bg-indigo-500"}`}
            style={{ width: `${Math.min(100, (used / workspaceCap) * 100)}%` }}
          />
        </div>
        <button
          disabled
          title="Premium billing is not available yet"
          className="mt-3 flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-2 text-xs font-bold text-slate-950 opacity-60"
        >
          <Crown className="h-3.5 w-3.5" /> Upgrade Plan (coming soon)
        </button>
        <p className="mt-2 text-center text-[10px] leading-snug text-slate-600">
          {workspaceCap} client workspaces per account. Premium upgrades coming soon.
        </p>
      </div>

      {/* User */}
      <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-3">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-800 text-xs font-bold text-indigo-300">
          {user?.email?.[0]?.toUpperCase() || "V"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-slate-300">{user?.email}</p>
        </div>
        <button
          onClick={logout}
          className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-800 hover:text-rose-300"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
