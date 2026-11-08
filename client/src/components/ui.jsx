import { createContext, useContext, useMemo, useState } from "react";
import { X, Check, Bell, Spark } from "./icons.jsx";

export function Button({ variant = "primary", size = "md", className = "", children, ...props }) {
  const variants = {
    primary:
      "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/40 disabled:bg-indigo-600/40",
    secondary: "bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700",
    ghost: "bg-transparent hover:bg-slate-800/60 text-slate-400 hover:text-slate-200",
    danger: "bg-rose-600/90 hover:bg-rose-500 text-white",
    success: "bg-emerald-600 hover:bg-emerald-500 text-white",
  };
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-sm" };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ className = "", ...props }) {
  return (
    <input
      className={`w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 ${className}`}
      {...props}
    />
  );
}

export function Badge({ tone = "slate", className = "", children }) {
  const tones = {
    slate: "bg-slate-800 text-slate-300 border-slate-700",
    indigo: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    rose: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 className="text-base font-bold text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-16 text-center">
      {icon && <div className="mb-3 opacity-70">{icon}</div>}
      <h3 className="text-base font-bold text-slate-200">{title}</h3>
      {subtitle && <p className="mt-1 max-w-sm text-sm text-slate-500">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <p className="mt-2 text-xs font-medium text-rose-400">{children}</p>;
}

/* =================================================================
 *  Toast system — replaces every native alert()/confirm() dialog.
 *  Usage: const toast = useToast(); toast.success("Saved"); toast.error("…"); toast.warning("…")
 * ================================================================= */

const ToastContext = createContext(null);

const TONE_STYLES = {
  success: {
    wrap: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 shadow-emerald-950/40",
    icon: "text-emerald-400",
  },
  warning: {
    wrap: "border-amber-500/40 bg-amber-500/10 text-amber-200 shadow-amber-950/40",
    icon: "text-amber-400",
  },
  error: {
    wrap: "border-rose-500/40 bg-rose-500/10 text-rose-200 shadow-rose-950/40",
    icon: "text-rose-400",
  },
};

function Toast({ tone = "success", message, onClose }) {
  const s = TONE_STYLES[tone] || TONE_STYLES.success;
  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-72 items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-2xl backdrop-blur ${s.wrap}`}
      style={{ animation: "toastIn 180ms ease-out" }}
    >
      {tone === "success" ? (
        <Check className={`mt-0.5 h-4 w-4 shrink-0 ${s.icon}`} />
      ) : tone === "warning" ? (
        <Bell className={`mt-0.5 h-4 w-4 shrink-0 ${s.icon}`} />
      ) : (
        <Spark className={`mt-0.5 h-4 w-4 shrink-0 ${s.icon}`} />
      )}
      <p className="min-w-0 flex-1 text-xs font-semibold leading-relaxed">{message}</p>
      <button
        onClick={onClose}
        className="opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = (id) => setToasts((list) => list.filter((t) => t.id !== id));

  const value = useMemo(
    () => ({
      success: (message, ttl = 4000) => showToast(setToasts, "success", message, ttl),
      warning: (message, ttl = 5000) => showToast(setToasts, "warning", message, ttl),
      error: (message, ttl = 6000) => showToast(setToasts, "error", message, ttl),
    }),
    []
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* stack */}
      <div className="pointer-events-none fixed right-4 top-4 z-[70] flex flex-col gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} tone={t.tone} message={t.message} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function showToast(setToasts, tone, message, ttl) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  setToasts((list) => [...list.slice(-4), { id, tone, message }]); // keep max 5 live
  window.setTimeout(() => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, ttl);
}

export const useToast = () => useContext(ToastContext);

/* In-app replacement for native confirm():
   returns the user's decision via onConfirm; never blocks via the browser.
   tone="warning" renders a prominent destructive-action banner. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
  busy = false,
  tone = "default",
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {tone === "warning" ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-sm font-medium leading-relaxed text-amber-200">{message}</p>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-slate-400">{message}</p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
