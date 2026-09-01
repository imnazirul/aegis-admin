import Link from "next/link";
import { notFound } from "next/navigation";

import { Stat } from "@/components/stat";
import { TrendChart } from "@/components/trend-chart";
import { UserControls } from "@/components/user-controls";
import { userDetail } from "@/lib/admin-user";
import { ago, bytes, limit, percent, when } from "@/lib/format";
import type { PeriodUsage } from "@/lib/usage";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await userDetail(id);
  if (!detail) notFound();

  const { user, usage, devices, history, sessions } = detail;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/users" className="text-xs text-muted hover:text-fg">
          ← Users
        </Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-3 text-lg font-semibold tracking-tight">
          {user.email}
          {user.blocked && (
            <span className="rounded border border-warn/40 px-2 py-0.5 text-xs font-normal text-warn">
              blocked
            </span>
          )}
        </h1>
        <p className="mt-1 text-xs text-muted">
          {user.timezone} · joined {ago(user.createdAt)} · {devices.length} of {user.deviceLimit}{" "}
          device{user.deviceLimit === 1 ? "" : "s"} enrolled
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <PeriodStat label="Today" period={usage.daily} />
        <PeriodStat label="This week" period={usage.weekly} />
        <PeriodStat label="This month" period={usage.monthly} />
      </div>

      <TrendChart points={history} />

      <div className="grid gap-4 lg:grid-cols-2">
        <UserControls
          userId={user.id}
          blocked={user.blocked}
          blockedReason={user.blockedReason}
          timezone={user.timezone}
          deviceLimit={user.deviceLimit}
          dailyLimitBytes={user.dailyLimitBytes}
          weeklyLimitBytes={user.weeklyLimitBytes}
          monthlyLimitBytes={user.monthlyLimitBytes}
        />

        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-border bg-surface">
            <h2 className="border-b border-border px-4 py-3 text-sm font-medium">Devices</h2>
            <ul>
              {devices.map((d) => (
                <li key={d.id} className="border-b border-border px-4 py-2 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{d.name || "Unnamed device"}</span>
                    <span className="text-xs text-muted">seen {ago(d.lastSeenAt)}</span>
                  </div>
                  <code className="mt-0.5 block truncate font-mono text-xs text-muted">
                    {d.publicKey}
                  </code>
                </li>
              ))}
              {devices.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted">
                  No devices enrolled. They have signed up but not yet connected.
                </li>
              )}
            </ul>
          </section>

          <section className="rounded-lg border border-border bg-surface">
            <h2 className="border-b border-border px-4 py-3 text-sm font-medium">
              Recent sessions
            </h2>
            <ul>
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2 text-sm last:border-0"
                >
                  <span className="text-muted">{when(s.startedAt)}</span>
                  <span className="flex items-center gap-3">
                    {s.endedAt === null && <span className="text-xs text-ok">connected</span>}
                    <span className="tnum text-xs text-muted">
                      {bytes(s.bytesUp + s.bytesDown)}
                    </span>
                  </span>
                </li>
              ))}
              {sessions.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-muted">
                  No sessions yet. These appear once a node reports them.
                </li>
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function PeriodStat({ label, period }: { label: string; period: PeriodUsage }) {
  const fraction =
    period.limitBytes !== null && period.limitBytes > 0 ? period.bytes / period.limitBytes : null;

  return (
    <Stat
      label={label}
      value={bytes(period.bytes)}
      tone={period.exceeded ? "danger" : fraction !== null && fraction >= 0.8 ? "warn" : "plain"}
      hint={
        <>
          {/* The state is always said in words; the colour only reinforces it. */}
          {period.exceeded
            ? `over the ${limit(period.limitBytes)} limit`
            : fraction !== null
              ? `${percent(fraction)} of ${limit(period.limitBytes)}`
              : "unlimited"}
          {" · resets "}
          {when(period.resetsAt)}
        </>
      }
    />
  );
}
