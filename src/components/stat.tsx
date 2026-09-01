import { type ReactNode } from "react";

/**
 * A headline number.
 *
 * Not a chart, on purpose: a single value over a single period has no shape to show, and
 * drawing one anyway is how dashboards end up full of decoration. The comparison line beneath
 * is what makes the number mean something.
 */
export function Stat({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "plain" | "ok" | "warn" | "danger";
}) {
  const toneClass = {
    plain: "text-fg",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`tnum mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
