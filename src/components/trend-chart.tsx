"use client";

import { useState } from "react";

import { bytes } from "@/lib/format";

export type TrendPoint = { day: string; bytes: number; users: number };

/**
 * Daily bandwidth across every account, for the last 90 days.
 *
 * A bar per day rather than a line. The data *is* discrete — one total per calendar day — and a
 * line between two days implies values in between that do not exist. Bars also make a missing
 * day visibly missing, which a line quietly interpolates over.
 *
 * One series, so there is no legend: the heading names it. Hover gives the exact value, because
 * an axis can only ever be read approximately and the precise number is the one people want.
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
        No traffic recorded yet. This fills in once a node starts reporting usage.
      </p>
    );
  }

  const peak = Math.max(...points.map((p) => p.bytes), 1);
  const width = 100;
  const height = 28;
  // A 2px gap between bars, expressed in the viewBox's units so it holds at any width.
  const step = width / points.length;
  const barWidth = Math.max(step - step * 0.25, step * 0.4);

  const active = hover === null ? null : points[hover];

  return (
    <figure className="rounded-lg border border-border bg-surface p-4">
      <figcaption className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Bandwidth per day</h2>
        <span className="text-xs text-muted">
          {active ? (
            <>
              <span className="text-fg">{active.day}</span> · {bytes(active.bytes)} ·{" "}
              {active.users} {active.users === 1 ? "user" : "users"}
            </>
          ) : (
            `last ${points.length} days · peak ${bytes(peak)}`
          )}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Daily bandwidth for the last ${points.length} days, peaking at ${bytes(peak)}`}
        className="mt-3 h-40 w-full"
        onMouseLeave={() => setHover(null)}
      >
        {points.map((point, i) => {
          const h = Math.max((point.bytes / peak) * height, point.bytes > 0 ? 0.5 : 0);
          return (
            <g key={point.day}>
              {/* A full-height hit target: a 1px-tall bar is impossible to hover deliberately. */}
              <rect
                x={i * step}
                y={0}
                width={step}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              <rect
                x={i * step + (step - barWidth) / 2}
                y={height - h}
                width={barWidth}
                height={h}
                rx={0.6}
                className={hover === i ? "fill-fg" : "fill-accent"}
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{points[0]?.day}</span>
        <span>{points[points.length - 1]?.day}</span>
      </div>
    </figure>
  );
}
