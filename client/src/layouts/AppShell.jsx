import { NavLink, Outlet } from "react-router-dom";
import SidebarHero from "../components/SidebarHero.jsx";
import CreateWorkspaceModal from "../components/CreateWorkspaceModal.jsx";
import StopwatchWidget from "../components/StopwatchWidget.jsx";
import { useWorkspaces, dotColor } from "../context/WorkspaceContext.jsx";
import { EmptyState } from "../components/ui.jsx";

const TABS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/sops", label: "SOP & Brand Vault" },
  { to: "/credentials", label: "Credentials Locker" },
  { to: "/tasks", label: "Task Board" },
  { to: "/settings", label: "Settings" },
];

export default function AppShell() {
  const { active, loading, setCreateOpen } = useWorkspaces();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        <div className="animate-pulse text-sm">Opening your switchboard…</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <SidebarHero />
      <CreateWorkspaceModal />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {active ? (
              <>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotColor(active)}`} />
                <h2 className="truncate text-sm font-bold text-slate-100">{active.name}</h2>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  workspace
                </span>
              </>
            ) : (
              <h2 className="text-sm font-bold text-slate-300">No client selected</h2>
            )}
          </div>
          <nav className="flex items-center gap-1">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? "bg-slate-800 text-indigo-300"
                      : "text-slate-500 hover:bg-slate-900 hover:text-slate-300"
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-slate-950 p-6 pb-28">
          {!active ? (
            <EmptyState
              title="No client workspace yet"
              subtitle="Create your first client to start collecting their SOPs, brand rules, credentials, and tasks behind one switchboard."
              action={
                <button
                  onClick={() => setCreateOpen(true)}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 hover:bg-indigo-500"
                >
                  Create your first workspace
                </button>
              }
            />
          ) : (
            <Outlet />
          )}
        </main>
        <StopwatchWidget />
      </div>
    </div>
  );
}
