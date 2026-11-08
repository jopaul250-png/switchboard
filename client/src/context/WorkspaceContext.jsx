import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, getStoredActiveWS, storeActiveWS } from "../api/client.js";

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [activeId, setActiveId] = useState(getStoredActiveWS());
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const d = await api("/workspaces");
    setWorkspaces(d.workspaces);
    setLoading(false);
    return d.workspaces;
  }, []);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  // Restore or repair the active workspace selection
  useEffect(() => {
    if (loading) return;
    if (!workspaces.some((w) => w.id === activeId)) {
      setActiveId(workspaces[0]?.id ?? null);
    }
  }, [loading, workspaces]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loading) storeActiveWS(activeId);
  }, [activeId, loading]);

  const switchWorkspace = (id) => setActiveId(id);

  const active = workspaces.find((w) => w.id === activeId) || null;

  /** Cheap reactive patch for one workspace (pulse counts, scope, plan…) */
  const patchWorkspace = (id, patch) =>
    setWorkspaces((list) => list.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  const createWorkspace = async (payload) => {
    const d = await api("/workspaces", { method: "POST", body: payload });
    setWorkspaces((list) => [...list, d.workspace]);
    setActiveId(d.workspace.id);
    storeActiveWS(d.workspace.id);
    return d.workspace;
  };

  const upgradeWorkspace = async (id) => {
    await api(`/workspaces/${id}`, { method: "PATCH", body: { plan_type: "premium" } });
    patchWorkspace(id, { plan_type: "premium" });
  };

  const freeUsed = workspaces.filter((w) => w.plan_type === "free").length;
  const MAX_FREE = 2;
  const atFreeLimit = freeUsed >= MAX_FREE;

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        active,
        activeId,
        loading,
        load,
        switchWorkspace,
        patchWorkspace,
        createWorkspace,
        upgradeWorkspace,
        freeUsed,
        atFreeLimit,
        maxFree: MAX_FREE,
        createOpen,
        setCreateOpen,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspaces = () => useContext(WorkspaceContext);

export const DOT_PALETTE = [
  "bg-emerald-400",
  "bg-sky-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-violet-400",
  "bg-teal-400",
  "bg-orange-400",
  "bg-pink-400",
];

export function dotColor(workspace) {
  return DOT_PALETTE[workspace.id % DOT_PALETTE.length];
}
