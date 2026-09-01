/**
 * Usage accounting, against the real database.
 *
 * The arithmetic is not the risky part — the SQL is. Three sums computed with `filter (where
 * ...)`, a range that has to cover the union of the weekly and monthly windows, and a `bigint`
 * that arrives from the driver as a string and becomes `NaN` if anyone forgets. Every one of
 * those fails in the same direction: usage reads as less than it is, and someone gets past a
 * limit they should have hit.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, users } from "@/db";
import { addUsage, exceededPeriod, usageFor } from "@/lib/usage";

const GB = 1024 ** 3;

// Wednesday 2026-03-11, 10:00 UTC — which is 16:00 the same day in Dhaka.
const NOW = new Date("2026-03-11T10:00:00Z");

let userId: string;
const created: string[] = [];

/**
 * A fresh account with no history.
 *
 * Tests that share one account share its accumulated usage, and an assertion then depends on
 * which tests ran before it — which is exactly how the week-boundary test below first went
 * wrong. Anything asserting an absolute total takes its own.
 */
async function newUser(): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `usage-${Date.now()}-${created.length}@example.test`,
      passwordHash: "not-a-real-hash",
      timezone: "Asia/Dhaka",
      dailyLimitBytes: 5 * GB,
      monthlyLimitBytes: 100 * GB,
    })
    .returning({ id: users.id });
  created.push(row!.id);
  return row!.id;
}

beforeAll(async () => {
  userId = await newUser();
});

afterAll(async () => {
  for (const id of created) await db.delete(users).where(eq(users.id, id));
});

function limits(overrides: Partial<Parameters<typeof usageFor>[1]> = {}) {
  return {
    timezone: "Asia/Dhaka",
    dailyLimitBytes: 5 * GB,
    weeklyLimitBytes: null,
    monthlyLimitBytes: 100 * GB,
    ...overrides,
  };
}

describe("usage accounting", () => {
  it("starts at zero rather than NaN", async () => {
    const usage = await usageFor(userId, limits(), NOW);
    expect(usage.daily.bytes).toBe(0);
    expect(usage.weekly.bytes).toBe(0);
    expect(usage.monthly.bytes).toBe(0);
  });

  it("adds up repeated reports for the same day", async () => {
    // The node flushes every 30 seconds or so, always into the same row. If the upsert
    // replaced instead of adding, all but the last report of the day would vanish.
    await addUsage(userId, "2026-03-11", 1_000, 2_000);
    await addUsage(userId, "2026-03-11", 500, 1_500);

    const usage = await usageFor(userId, limits(), NOW);
    expect(usage.daily.bytes).toBe(5_000);
  });

  it("separates days, and rolls them into the week and the month", async () => {
    await addUsage(userId, "2026-03-09", 10, 0); // Monday, the week's first day
    await addUsage(userId, "2026-03-10", 20, 0); // Tuesday
    await addUsage(userId, "2026-03-15", 40, 0); // Sunday, still this week

    const usage = await usageFor(userId, limits(), NOW);
    expect(usage.daily.bytes, "Wednesday alone").toBe(5_000);
    expect(usage.weekly.bytes, "Monday through Sunday").toBe(5_070);
    expect(usage.monthly.bytes).toBe(5_070);
  });

  it("excludes the day before the week started", async () => {
    // 2026-03-08 is the Sunday that ends the *previous* week. Counting it would be the
    // off-by-one that "weeks start on Monday" exists to prevent.
    await addUsage(userId, "2026-03-08", 999, 0);

    const usage = await usageFor(userId, limits(), NOW);
    expect(usage.weekly.bytes).toBe(5_070);
    expect(usage.monthly.bytes, "still the same month, though").toBe(6_069);
  });

  it("counts a week that runs back into the previous month", async () => {
    // The query's outer range is the union of the weekly and monthly windows. Scanning only
    // the month would silently drop the days of a week that began in February — which happens
    // several times a year and would be very hard to notice.
    const alone = await newUser();
    await addUsage(alone, "2026-02-23", 7_000, 0); // Monday
    await addUsage(alone, "2026-02-28", 3_000, 0); // Saturday
    await addUsage(alone, "2026-03-05", 100, 0); // the following week, in March

    // 2026-03-01 is a Sunday, so its week began on Monday 2026-02-23 — in the previous month.
    const sunday = await usageFor(alone, limits(), new Date("2026-03-01T10:00:00Z"));
    expect(sunday.weekly.from).toBe("2026-02-23");
    expect(sunday.weekly.to).toBe("2026-03-01");
    expect(sunday.weekly.bytes, "reaches back past the month boundary").toBe(10_000);
    expect(sunday.monthly.from).toBe("2026-03-01");
    expect(sunday.monthly.bytes, "March holds only what happened in March").toBe(100);
  });

  it("includes the Sunday that ends a week, and excludes the one before it", async () => {
    const alone = await newUser();
    await addUsage(alone, "2026-03-01", 1, 0); // Sunday — the *previous* week
    await addUsage(alone, "2026-03-02", 10, 0); // Monday — this week starts
    await addUsage(alone, "2026-03-08", 100, 0); // Sunday — still this week

    const usage = await usageFor(alone, limits(), new Date("2026-03-04T10:00:00Z"));
    expect(usage.weekly.from).toBe("2026-03-02");
    expect(usage.weekly.to).toBe("2026-03-08");
    expect(usage.weekly.bytes, "Monday and the Sunday that closes the week").toBe(110);
  });

  it("is a real number, not a string from the driver", async () => {
    const usage = await usageFor(userId, limits(), NOW);
    expect(typeof usage.daily.bytes).toBe("number");
    expect(Number.isNaN(usage.daily.bytes)).toBe(false);
  });
});

describe("limits", () => {
  it("is not exceeded below the limit, and is at it", async () => {
    const under = await usageFor(userId, limits({ dailyLimitBytes: 6_000 }), NOW);
    expect(under.daily.exceeded).toBe(false);

    const at = await usageFor(userId, limits({ dailyLimitBytes: 5_000 }), NOW);
    expect(at.daily.exceeded, "reaching the limit counts as reaching it").toBe(true);
  });

  it("treats null as unlimited", async () => {
    const usage = await usageFor(userId, limits({ dailyLimitBytes: null }), NOW);
    expect(usage.daily.limitBytes).toBeNull();
    expect(usage.daily.exceeded).toBe(false);
  });

  it("reports the shortest exceeded period, because it frees up soonest", async () => {
    const usage = await usageFor(
      userId,
      limits({ dailyLimitBytes: 1, weeklyLimitBytes: 1, monthlyLimitBytes: 1 }),
      NOW,
    );
    expect(exceededPeriod(usage)?.kind).toBe("daily");
  });

  it("reports nothing exceeded when everything is unlimited", async () => {
    const usage = await usageFor(
      userId,
      limits({ dailyLimitBytes: null, weeklyLimitBytes: null, monthlyLimitBytes: null }),
      NOW,
    );
    expect(exceededPeriod(usage)).toBeNull();
  });

  it("resets at the user's own midnight", async () => {
    const usage = await usageFor(userId, limits(), NOW);
    // Dhaka is UTC+6, so their midnight is 18:00 UTC the day before.
    expect(usage.daily.resetsAt.toISOString()).toBe("2026-03-11T18:00:00.000Z");
    expect(usage.weekly.resetsAt.toISOString()).toBe("2026-03-15T18:00:00.000Z");
    expect(usage.monthly.resetsAt.toISOString()).toBe("2026-03-31T18:00:00.000Z");
  });
});
