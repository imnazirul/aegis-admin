/**
 * Everything the dashboard shows.
 *
 * # What "this month" means here
 *
 * Every user has their own timezone, so they do not all start a month at the same instant. A
 * platform total is therefore the **sum of each user's own local month**, not a single UTC
 * window. At a month boundary that differs from a true UTC month by up to a day's traffic.
 *
 * That is the right trade for a dashboard: invisible on a chart, and it needs no second rollup
 * table kept in step with the first. It would be the wrong trade if these numbers were ever
 * used to bill anyone, and that is the moment to add a UTC-keyed rollup — not before.
 */

import { sql } from "drizzle-orm";

import { db } from "@/db";

/** How far back the trend chart reaches. */
const TREND_DAYS = 90;

/**
 * How close to a limit counts as "about to complain".
 *
 * Cast to `numeric` where it is used: multiplied against a `bigint` column, Postgres infers the
 * bind parameter as `bigint` too and rejects 0.8 outright.
 */
const NEAR_LIMIT = 0.8;

type Row = Record<string, unknown>;

/** The neon-http driver returns rows directly on some versions and `{ rows }` on others. */
function rows(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  const maybe = (result as { rows?: unknown })?.rows;
  return Array.isArray(maybe) ? (maybe as Row[]) : [];
}

const n = (v: unknown) => Number(v ?? 0);

/** A single snapshot of the whole platform. */
export async function platformStats() {
  const [totals, trend, top, counts, nearLimit, recent] = await Promise.all([
    // This month and last month, each user in their own timezone.
    db.execute(sql`
      select
        coalesce(sum(d.bytes_up + d.bytes_down) filter (
          where d.local_day >= date_trunc('month', now() at time zone u.timezone)::date
        ), 0)::bigint as this_month,
        coalesce(sum(d.bytes_up + d.bytes_down) filter (
          where d.local_day >= (date_trunc('month', now() at time zone u.timezone) - interval '1 month')::date
            and d.local_day <  date_trunc('month', now() at time zone u.timezone)::date
        ), 0)::bigint as last_month,
        coalesce(sum(d.bytes_up + d.bytes_down) filter (
          where d.local_day = (now() at time zone u.timezone)::date
        ), 0)::bigint as today
      from usage_daily d
      join users u on u.id = d.user_id
    `),

    // Two casts, both load-bearing.
    //
    // `::text` on the day, because the driver otherwise turns a `date` into a JS `Date` using
    // the *server's* timezone, which shifts every label by a day for half the world.
    //
    // `::int` on the parameter, because Postgres has an overload for date minus integer
    // (giving a date) and another for date minus date (giving an integer). With an untyped
    // bind parameter it chooses the second, and the comparison becomes `date >= integer` —
    // which fails at runtime, not at compile time.
    db.execute(sql`
      select local_day::text as day,
             sum(bytes_up + bytes_down)::bigint as bytes,
             count(distinct user_id)::int as users
      from usage_daily
      where local_day >= (current_date - ${TREND_DAYS}::int)
      group by local_day
      order by local_day
    `),

    db.execute(sql`
      select u.id, u.email, u.timezone, u.blocked_at is not null as blocked,
             sum(d.bytes_up + d.bytes_down)::bigint as bytes
      from usage_daily d
      join users u on u.id = d.user_id
      where d.local_day >= date_trunc('month', now() at time zone u.timezone)::date
      group by u.id
      order by bytes desc
      limit 10
    `),

    db.execute(sql`
      select
        (select count(*)::int from users) as total_users,
        (select count(*)::int from users where blocked_at is not null) as blocked_users,
        (select count(*)::int from users where created_at >= now() - interval '30 days') as new_users,
        (select count(*)::int from devices where revoked_at is null) as devices,
        (select count(*)::int from tunnel_sessions where ended_at is null) as connected,
        (select count(distinct d.user_id)::int
           from usage_daily d join users u on u.id = d.user_id
          where d.local_day = (now() at time zone u.timezone)::date) as active_today
    `),

    // Who is about to run out. The most actionable thing on the page: these are the people who
    // will write to you tomorrow.
    db.execute(sql`
      select u.id, u.email, u.monthly_limit_bytes::bigint as limit_bytes,
             coalesce(sum(d.bytes_up + d.bytes_down), 0)::bigint as bytes
      from users u
      left join usage_daily d
        on d.user_id = u.id
       and d.local_day >= date_trunc('month', now() at time zone u.timezone)::date
      where u.monthly_limit_bytes is not null and u.blocked_at is null
      group by u.id
      having coalesce(sum(d.bytes_up + d.bytes_down), 0) >= u.monthly_limit_bytes * ${NEAR_LIMIT}::numeric
      order by bytes desc
      limit 10
    `),

    db.execute(sql`
      select id, email, created_at, blocked_at is not null as blocked
      from users order by created_at desc limit 5
    `),
  ]);

  const t = rows(totals)[0] ?? {};
  const c = rows(counts)[0] ?? {};

  return {
    totals: {
      today: n(t.today),
      thisMonth: n(t.this_month),
      lastMonth: n(t.last_month),
    },
    counts: {
      users: n(c.total_users),
      blocked: n(c.blocked_users),
      newLast30Days: n(c.new_users),
      devices: n(c.devices),
      connectedNow: n(c.connected),
      activeToday: n(c.active_today),
    },
    trend: rows(trend).map((r) => ({
      day: String(r.day),
      bytes: n(r.bytes),
      users: n(r.users),
    })),
    topUsers: rows(top).map((r) => ({
      id: String(r.id),
      email: String(r.email),
      timezone: String(r.timezone),
      blocked: Boolean(r.blocked),
      bytes: n(r.bytes),
    })),
    nearLimit: rows(nearLimit).map((r) => ({
      id: String(r.id),
      email: String(r.email),
      bytes: n(r.bytes),
      limitBytes: n(r.limit_bytes),
      fraction: n(r.limit_bytes) > 0 ? n(r.bytes) / n(r.limit_bytes) : 0,
    })),
    recentUsers: rows(recent).map((r) => ({
      id: String(r.id),
      email: String(r.email),
      createdAt: r.created_at,
      blocked: Boolean(r.blocked),
    })),
    /** Stated in the payload so a chart can label itself honestly. See the note above. */
    note: "platform totals are the sum of each user's own local day",
  };
}
