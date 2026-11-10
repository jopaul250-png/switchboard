import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useWorkspaces } from "../context/WorkspaceContext.jsx";
import { Badge, Button, Input, EmptyState, ConfirmModal, useToast } from "../components/ui.jsx";
import { Search, Plus, Doc, Trash, ArrowLeft } from "../components/icons.jsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const CATEGORIES = ["general", "brand-guidelines", "formatting-rules", "voice-tone", "palette"];

export default function SopsPage() {
  const { active } = useWorkspaces();
  const toast = useToast();
  const [sops, setSops] = useState([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editing, setEditing] = useState(null); // null | 'new' | sop object
  const [draft, setDraft] = useState({ title: "", category: "general", content: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // P1: in-app deletion confirm (replaces native confirm())
  const [pendingDelete, setPendingDelete] = useState(null); // sop object | null
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!active) return;
    setEditing(null);
    setQuery("");
    setCategoryFilter("all");
    api(`/workspaces/${active.id}/sops`)
      .then((d) => setSops(d.sops))
      .catch(() => {});
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => {
    setDraft({ title: "", category: "general", content: "# Heading\n\nDescribe the rule here." });
    setEditing("new");
  };
  const openEdit = (sop) => {
    setDraft({ title: sop.title, category: sop.category, content: sop.content });
    setEditing(sop);
  };

  const save = async () => {
    // Never silently blocked: if a title is missing, surface it instead of a dead button.
    if (!draft.title.trim()) {
      setError("Add a title first — then Save is always available.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = { ...draft, title: draft.title.trim() };
      if (editing === "new") {
        const d = await api(`/workspaces/${active.id}/sops`, { method: "POST", body: payload });
        setSops((l) => [d.sop, ...l]);
      } else {
        const d = await api(`/workspaces/${active.id}/sops/${editing.id}`, {
          method: "PUT",
          body: payload,
        });
        setSops((l) => l.map((s) => (s.id === d.sop.id ? d.sop : s)));
      }
      setEditing(null);
      toast.success(editing === "new" ? "SOP created" : "SOP saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false); // can never get stuck disabled
    }
  };

  /* P1: open the confirm modal instead of the native confirm() dialog */
  const requestDelete = (sop) => setPendingDelete(sop);

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return; // duplicate-click guard
    const target = pendingDelete;
    setDeleting(true);
    try {
      await api(`/workspaces/${active.id}/sops/${target.id}`, { method: "DELETE" });
      setSops((l) => l.filter((s) => s.id !== target.id));
      setPendingDelete(null);
      toast.success(`"${target.title}" deleted`);
    } catch (err) {
      // keep the SOP visible; surface what went wrong
      setPendingDelete(null);
      toast.error(`Could not delete "${target.title}" — ${err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  if (editing) {
    /* ================= Split-pane editor ================= */
    return (
      <div className="flex h-[calc(100vh-130px)] flex-col">
        {/* editor toolbar */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back to vault
          </Button>
          <div className="flex-1" />
          <Button onClick={save} disabled={busy} title="Save (requires a title)">
            Save
          </Button>
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            autoFocus
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Document title — e.g. Summit Brand Voice Rules"
            className="font-semibold"
          />
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        {/* split pane */}
        <div className="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-3">
          <textarea
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            spellCheck={false}
            className="h-full w-full resize-none rounded-2xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-indigo-500/60"
            placeholder="Markdown… brand guidelines, hex codes, do/don't lists"
          />
          <div className="sop-preview h-full overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  /* ================= Card grid ================= */
  const q = query.trim().toLowerCase();
  const visible = sops.filter(
    (s) =>
      (categoryFilter === "all" || s.category === categoryFilter) &&
      (!q ||
        s.title.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q))
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search SOPs, brand rules, hex codes…"
            className="pl-9"
          />
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4" /> New document
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {["all", ...CATEGORIES].map((c) => (
          <button
            key={c}
            onClick={() => setCategoryFilter(c)}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
              categoryFilter === c
                ? "bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40"
                : "bg-slate-900 text-slate-500 ring-1 ring-slate-800 hover:text-slate-300"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Doc className="h-8 w-8 text-slate-600" />}
          title={sops.length === 0 ? "Brand vault is empty" : "No matches"}
          subtitle="Store client brand guidelines, color hex codes, typography and formatting rules as markdown cards."
          action={
            sops.length === 0 && (
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" /> Create the first document
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((sop) => (
            <button
              key={sop.id}
              onClick={() => openEdit(sop)}
              className="group flex flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-left transition-colors hover:border-indigo-500/40 hover:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="line-clamp-1 font-bold text-slate-200">{sop.title}</h3>
                <Trash
                  className="h-4 w-4 shrink-0 text-slate-700 transition-colors hover:text-rose-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestDelete(sop);
                  }}
                />
              </div>
              <Badge tone="indigo" className="mt-2 w-fit">
                {sop.category}
              </Badge>
              <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-slate-500">
                {sop.content.replace(/[#*`>\-]/g, "").slice(0, 140) || "Empty document"}
              </p>
              <p className="mt-3 text-[10px] text-slate-600">
                updated {new Date(sop.updated_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* P1: in-app deletion confirmation (replaces the native confirm() dialog) */}
      {pendingDelete && (
        <ConfirmModal
          open
          onClose={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
          tone="warning"
          title="Delete SOP document?"
          message={`You are about to permanently delete "${pendingDelete.title}". This cannot be undone.`}
          confirmLabel="Permanently Delete"
          busy={deleting}
        />
      )}
    </div>
  );
}
