/**
 * How much a user has consumed, and how much they are allowed.
 *
 * Everything derives from `usage_daily` — one row per user per calendar day in that user's own
 * timezone. Daily is one row, weekly is seven, monthly is a month, and because they are all
 * sums over the same table they can never disagree with each other.
 */

import { sql } from "drizzle-orm";

import { db, usageDaily } from "@/db";
import { localDay, periodRange, periodResetsAt, type Day, type PeriodKind } from "./period";

export type PeriodUsage = {
  kind: PeriodKind;
  /** Inclusive calendar range, in the user's timezone. */
  from: Day;
  to: Day;
  /** Bytes consumed, both directions together. */
  bytes: number;
  /** `null` means unlimited. */
  limitBytes: number | null;
  /** Whether the limit is reached. Always `false` when unlimited. */
  exceeded: boolean;
  /** When this period rolls over, as an instant. */
  resetsAt: Date;
};

export type UsageSummary = Record<PeriodKind, PeriodUsage>;

export type Limits = {
  timezone: string;
  dailyLimitBytes: number | null;
  weeklyLimitBytes: number | null;
  monthlyLimitBytes: number | null;
};

/** The earlier of two calendar dates. */
const min = (a: Day, b: Day) => (a < b ? a : b);
const max = (a: Day, b: Day) => (a > b ? a : b);

/**
 * All three periods for one user, in a single query.
 *
 * `filter (where ...)` computes the three sums in one pass rather than three round trips, which
 * matters because this runs on every status poll from every connected client.
 *
 * The outer range is the union of the weekly and monthly ranges, not just the monthly one: a
 * week straddles a month boundary five times a year, and scanning only the month would quietly
 * undercount the first days of it.
 */
export async function usageFor(
  userId: string,
  limits: Limits,
  now: Date = new Date(),
): Promise<UsageSummary> {
  const today = localDay(now, limits.timezone);
  const day = periodRange("daily", today);
  const week = periodRange("weekly", today);
  const month = periodRange("monthly", today);

  const lo = min(week.from, month.from);
  const hi = max(week.to, month.to);

  const bytes = sql`coalesce(${usageDaily.bytesUp} + ${usageDaily.bytesDown}, 0)`;

  const rows = await db
    .select({
      daily: sql<number>`coalesce(sum(${bytes}) filter (where ${usageDaily.localDay} = ${day.from}), 0)::bigint`,
      weekly: sql<number>`coalesce(sum(${bytes}) filter (where ${usageDaily.localDay} between ${week.from} and ${week.to}), 0)::bigint`,
      monthly: sql<number>`coalesce(sum(${bytes}) filter (where ${usageDaily.localDay} between ${month.from} and ${month.to}), 0)::bigint`,
    })
    .from(usageDaily)
    .where(
      sql`${usageDaily.userId} = ${userId} and ${usageDaily.localDay} between ${lo} and ${hi}`,
    );

  const row = rows[0];
  const build = (
    kind: PeriodKind,
    range: { from: Day; to: Day },
    raw: unknown,
    limitBytes: number | null,
  ): PeriodUsage => {
    // Postgres returns bigint sums as strings through the driver; anything else would silently
    // become NaN and read as zero usage, which is the failure that lets someone past a limit.
    const consumed = Number(raw ?? 0);
    return {
      kind,
      from: range.from,
      to: range.to,
      bytes: Number.isFinite(consumed) ? consumed : 0,
      limitBytes,
      exceeded: limitBytes !== null && consumed >= limitBytes,
      resetsAt: periodResetsAt(kind, now, limits.timezone),
    };
  };

  return {
    daily: build("daily", day, row?.daily, limits.dailyLimitBytes),
    weekly: build("weekly", week, row?.weekly, limits.weeklyLimitBytes),
    monthly: build("monthly", month, row?.monthly, limits.monthlyLimitBytes),
  };
}

/**
 * Which limit, if any, a user is currently over.
 *
 * Returns the *shortest* period that is exceeded, because that is the one that will free up
 * soonest and therefore the one worth telling them about. Someone over both their daily and
 * monthly limit is told about the daily one; it resets tonight.
 */
export function exceededPeriod(usage: UsageSummary): PeriodUsage | null {
  return (
    [usage.daily, usage.weekly, usage.monthly].find((p) => p.exceeded) ?? null
  );
}

/**
 * Add consumption to a user's day.
 *
 * The node calls this, repeatedly, for the same row. `on conflict do update` with `+=` rather
 * than a read-modify-write: two reports landing at once must add up, and a lost update here is
 * bandwidth the user got for free.
 */
export async function addUsage(
  userId: string,
  day: Day,
  bytesUp: number,
  bytesDown: number,
): Promise<void> {
  await db
    .insert(usageDaily)
    .values({ userId, localDay: day, bytesUp, bytesDown })
    .onConflictDoUpdate({
      target: [usageDaily.userId, usageDaily.localDay],
      set: {
        bytesUp: sql`${usageDaily.bytesUp} + ${bytesUp}`,
        bytesDown: sql`${usageDaily.bytesDown} + ${bytesDown}`,
        updatedAt: sql`now()`,
      },
    });
}
