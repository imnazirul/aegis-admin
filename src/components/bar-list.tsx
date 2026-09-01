import Link from "next/link";

import { bytes, percent } from "@/lib/format";

export type BarRow = {
  id: string;
  label: string;
  value: number;
  /** 0–1, when the row is measured against a limit rather than against the largest row. */
  fraction?: number;
  note?: string;
  tone?: "accent" | "warn" | "danger";
};

/**
 * A ranked list with a bar behind each row.
 *
 * Horizontal, because the labels are email addresses — vertical bars would need them rotated,
 * and a rotated label is a label nobody reads. Each row is a link, because the only useful
 * thing to do with "who used the most" is go and look at them.
 */
export function BarList({ rows, empty }: { rows: BarRow[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>;
  }

  const peak = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="flex flex-col">
      {rows.map((row) => {
        const width = (row.fraction ?? row.value / peak) * 100;
        const fill = {
          accent: "bg-accent/25",
          warn: "bg-warn/25",
          danger: "bg-danger/25",
        }[row.tone ?? "accent"];

        return (
          <li key={row.id} className="border-b border-border last:border-0">
            <Link
              href={`/users/${row.id}`}
              className="relative flex items-center justify-between gap-4 px-4 py-2 transition-colors hover:bg-surface-2"
            >
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 ${fill}`}
                style={{ width: `${Math.min(width, 100)}%` }}
              />
              <span className="relative truncate text-sm">{row.label}</span>
              <span className="relative flex shrink-0 items-baseline gap-2">
                {row.note && <span className="text-xs text-muted">{row.note}</span>}
                <span className="tnum text-sm">{bytes(row.value)}</span>
                {row.fraction !== undefined && (
                  <span className="tnum w-10 text-right text-xs text-muted">
                    {percent(row.fraction)}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
