import Link from "next/link";

import { BarList } from "@/components/bar-list";
import { Stat } from "@/components/stat";
import { TrendChart } from "@/components/trend-chart";
import { ago, bytes, percent } from "@/lib/format";
import { platformStats } from "@/lib/stats";

export default async function DashboardPage() {
  const stats = await platformStats();

  const change =
    stats.totals.lastMonth > 0
      ? (stats.totals.thisMonth - stats.totals.lastMonth) / stats.totals.lastMonth
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Bandwidth this month"
          value={bytes(stats.totals.thisMonth)}
          hint={
            change === null
              ? "no traffic last month to compare"
              : `${change >= 0 ? "+" : ""}${percent(change)} vs last month (${bytes(stats.totals.lastMonth)})`
          }
        />
        <Stat label="Today" value={bytes(stats.totals.today)} hint={`${stats.counts.activeToday} accounts active`} />
        <Stat
          label="Connected now"
          value={stats.counts.connectedNow}
          hint={`${stats.counts.devices} devices enrolled`}
        />
        <Stat
          label="Users"
          value={stats.counts.users}
          hint={
            stats.counts.blocked > 0
              ? `${stats.counts.blocked} blocked · ${stats.counts.newLast30Days} new in 30 days`
              : `${stats.counts.newLast30Days} new in 30 days`
          }
          tone={stats.counts.blocked > 0 ? "warn" : "plain"}
        />
      </div>

      <TrendChart points={stats.trend} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border px-4 py-3 text-sm font-medium">
            Most bandwidth this month
          </h2>
          <BarList
            rows={stats.topUsers.map((u) => ({
              id: u.id,
              label: u.email,
              value: u.bytes,
              // Blocked is said in words, never by colour alone.
              note: u.blocked ? "blocked" : undefined,
              tone: u.blocked ? "warn" : "accent",
            }))}
            empty="Nobody has used any bandwidth this month."
          />
        </section>

        <section className="rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border px-4 py-3 text-sm font-medium">
            Approaching their limit
          </h2>
          {/*
            The most actionable panel on the page. Totals tell you how the month is going;
            this tells you who is going to write to you tomorrow.
          */}
          <BarList
            rows={stats.nearLimit.map((u) => ({
              id: u.id,
              label: u.email,
              value: u.bytes,
              fraction: u.fraction,
              note: u.fraction >= 1 ? "over" : "near",
              tone: u.fraction >= 1 ? "danger" : "warn",
            }))}
            empty="Nobody is near a limit."
          />
        </section>
      </div>

      <section className="rounded-lg border border-border bg-surface">
        <h2 className="border-b border-border px-4 py-3 text-sm font-medium">Newest accounts</h2>
        <ul>
          {stats.recentUsers.map((u) => (
            <li key={u.id} className="border-b border-border last:border-0">
              <Link
                href={`/users/${u.id}`}
                className="flex items-center justify-between px-4 py-2 text-sm transition-colors hover:bg-surface-2"
              >
                <span className="truncate">{u.email}</span>
                <span className="flex items-center gap-3 text-xs text-muted">
                  {u.blocked && <span className="text-warn">blocked</span>}
                  {ago(u.createdAt as string)}
                </span>
              </Link>
            </li>
          ))}
          {stats.recentUsers.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">No accounts yet.</li>
          )}
        </ul>
      </section>

      <p className="text-xs text-muted">{stats.note}.</p>
    </div>
  );
}
