/**
 * The user list, as the admin panel needs it.
 *
 * Shared by the page (a server component reading it directly) and the API route (for anything
 * that wants it over HTTP). One implementation, so the two can never disagree about what
 * "this month" means.
 */

import { and, desc, ilike, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import { db, users } from "@/db";

export const PAGE_SIZE = 50;

export type UserRow = {
  id: string;
  email: string;
  timezone: string;
  deviceLimit: number;
  dailyLimitBytes: number | null;
  weeklyLimitBytes: number | null;
  monthlyLimitBytes: number | null;
  blockedAt: Date | null;
  blockedReason: string | null;
  createdAt: Date;
  todayBytes: number;
  monthBytes: number;
  devices: number;
  blocked: boolean;
};

/**
 * Consumption since the start of the user's own current day, week or month.
 *
 * A scalar subquery rather than a join. Joining `usage_daily` *and* `devices` in one statement
 * produces a cartesian product — thirty daily rows against two devices is sixty rows — and the
 * sums come out doubled. It is a silent wrong answer, not an error, which is why it is worth
 * avoiding structurally rather than remembering to be careful.
 */
function consumed(truncTo: "day" | "week" | "month"): SQL<string> {
  const start =
    truncTo === "day"
      ? sql`(now() at time zone ${users.timezone})::date`
      : sql`date_trunc(${truncTo}, now() at time zone ${users.timezone})::date`;

  return sql<string>`(
    select coalesce(sum(d.bytes_up + d.bytes_down), 0)
    from usage_daily d
    where d.user_id = ${users.id} and d.local_day >= ${start}
  )`;
}

const deviceCount = sql<number>`(
  select count(*)::int from devices dev
  where dev.user_id = ${users.id} and dev.revoked_at is null
)`;

export type ListOptions = { query?: string; status?: string; page?: number };

export async function listUsers({ query = "", status = "all", page = 0 }: ListOptions) {
  const filters: SQL[] = [];
  if (query) filters.push(ilike(users.email, `%${query}%`));
  if (status === "blocked") filters.push(isNotNull(users.blockedAt));
  if (status === "active") filters.push(isNull(users.blockedAt));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, counted] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        timezone: users.timezone,
        deviceLimit: users.deviceLimit,
        dailyLimitBytes: users.dailyLimitBytes,
        weeklyLimitBytes: users.weeklyLimitBytes,
        monthlyLimitBytes: users.monthlyLimitBytes,
        blockedAt: users.blockedAt,
        blockedReason: users.blockedReason,
        createdAt: users.createdAt,
        todayBytes: consumed("day"),
        monthBytes: consumed("month"),
        devices: deviceCount,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(PAGE_SIZE)
      .offset(page * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(where),
  ]);

  const total = counted[0]?.n ?? 0;
  return {
    users: rows.map(
      (r): UserRow => ({
        ...r,
        // A `sum` of bigint arrives as a string. Left alone it becomes NaN in the UI, or worse
        // sorts as text — where "9" is larger than "10000000000".
        todayBytes: Number(r.todayBytes),
        monthBytes: Number(r.monthBytes),
        blocked: r.blockedAt !== null,
      }),
    ),
    page,
    pageSize: PAGE_SIZE,
    total,
    hasMore: (page + 1) * PAGE_SIZE < total,
  };
}
