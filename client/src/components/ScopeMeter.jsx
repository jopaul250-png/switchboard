import { Clock } from "./icons.jsx";

/**
 * Scope Meter — the billable-allocation guardrail.
 * hours_used vs contract_hours with color escalation:
 * < 75% green · 75-100% amber · > 100% red.
 */
export default function ScopeMeter({ hoursUsed, contractHours, compact = false }) {
  const used = Number(hoursUsed) || 0;
  const total = Number(contractHours) || 0;
  const pct = total > 0 ? (used / total) * 100 : 0;
  const over = pct >= 100;

  const tone = over
    ? { bar: "bg-rose-500", text: "text-rose-400", ring: "ring-rose-500/40" }
    : pct >= 75
      ? { bar: "bg-amber-500", text: "text-amber-400", ring: "ring-amber-500/40" }
      : { bar: "bg-emerald-500", text: "text-emerald-400", ring: "ring-emerald-500/40" };

  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/60 ${compact ? "p-3" : "p-5"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className={`h-4 w-4 ${tone.text}`} />
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
            Scope Meter
          </span>
        </div>
        <span className={`text-sm font-extrabold ${tone.text}`}>
          {used.toFixed(1)} / {total.toFixed(1)}h
        </span>
      </div>

      <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-950 ring-1 ring-slate-800">
        <div
          className={`h-full rounded-full transition-all duration-700 ${tone.bar}`}
          style={{ width: `${Math.min(100, Math.max(over ? 100 : pct, 2))}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>{pct.toFixed(0)}% of contract allocation</span>
        {over ? (
          <span className="font-bold text-rose-400">⚠ Over billable limit</span>
        ) : pct >= 75 ? (
          <span className="font-bold text-amber-400">Approaching limit</span>
        ) : (
          <span>Healthy</span>
        )}
      </div>
    </div>
  );
}
