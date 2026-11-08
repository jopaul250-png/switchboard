import { useState } from "react";
import { Modal, Button, Input, Badge, ErrorText, useToast } from "./ui.jsx";
import { useWorkspaces, dotColor } from "../context/WorkspaceContext.jsx";
import { Plus, Crown } from "./icons.jsx";

export default function CreateWorkspaceModal() {
  const { createOpen, setCreateOpen, workspaces, createWorkspace, upgradeWorkspace } =
    useWorkspaces();
  const toast = useToast();
  const [name, setName] = useState("");
  const [hours, setHours] = useState(40);
  const [error, setError] = useState(null);
  const [limitHit, setLimitHit] = useState(false);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setCreateOpen(false);
    setName("");
    setHours(40);
    setError(null);
    setLimitHit(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLimitHit(false);
    setBusy(true);
    try {
      const created = await createWorkspace({ name, contract_hours: Number(hours) || 40 });
      close();
      toast.success(`Workspace "${created?.name || name}" created`, 4500);
    } catch (err) {
      if (err.status === 402 || err.body?.code === "WORKSPACE_LIMIT") {
        setLimitHit(true);
        toast.warning("Free plan limit reached — 2/2 workspaces. Upgrade a client to free a slot.");
      } else {
        setError(err.message);
        toast.error(`Could not create workspace — ${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const upgrade = async (id) => {
    setBusy(true);
    try {
      await upgradeWorkspace(id);
      setError(null);
      setLimitHit(false);
      toast.success("Client upgraded to Premium — a free slot is now available");
    } catch (err) {
      setError(err.message);
      toast.error(`Upgrade failed — ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const freeTodo = workspaces.filter((w) => w.plan_type === "free");

  return (
    <Modal open={createOpen} onClose={close} title="Create Client Workspace">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
            Client name
          </label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summit Coffee Co."
            maxLength={60}
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
            Monthly contract hours
          </label>
          <Input
            type="number"
            min="0"
            step="1"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </div>

        {limitHit && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs font-semibold text-amber-300">
                🚧 Free plan limit reached — 2/2 workspaces in use.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
              Upgrade a client to Premium below to free up a slot (Trello-style: premium seats
              replace free ones).
            </p>
            <div className="mt-2 space-y-1.5">
              {freeTodo.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => upgrade(w.id)}
                  className="flex w-full items-center justify-between rounded-lg bg-slate-950/70 px-3 py-2 text-left ring-1 ring-slate-800 transition-colors hover:ring-amber-500/50"
                >
                  <span className="flex items-center gap-2 text-xs font-medium text-slate-200">
                    <span className={`h-2 w-2 rounded-full ${dotColor(w)}`} /> {w.name}
                  </span>
                  <Badge tone="amber">
                    <Crown className="h-2.5 w-2.5" /> Make Premium
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        )}
        {error && !limitHit && <ErrorText>{error}</ErrorText>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            <Plus className="h-4 w-4" /> Create workspace
          </Button>
        </div>
      </form>
    </Modal>
  );
}
