import { useState } from "react";
import { Modal, Button, Input, ErrorText, useToast } from "./ui.jsx";
import { useWorkspaces } from "../context/WorkspaceContext.jsx";
import { Plus } from "./icons.jsx";

export default function CreateWorkspaceModal() {
  const { createOpen, setCreateOpen, workspaces, createWorkspace } = useWorkspaces();
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
        toast.warning(`Workspace limit reached (${workspaces.length} in use) — Premium upgrades are coming soon.`);
      } else {
        setError(err.message);
        toast.error(`Could not create workspace — ${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

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
                🚧 Workspace limit reached — {workspaces.length} workspaces in use.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
              Each account is limited to 10 client workspaces. Premium upgrades are coming soon.
            </p>
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
