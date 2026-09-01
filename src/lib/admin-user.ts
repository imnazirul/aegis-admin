/**
 * Everything about one user, for the detail page and the API route that mirrors it.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db, devices, tunnelSessions, users } from "@/db";
import { usageFor } from "@/lib/usage";

/** How much daily history the detail page charts. */
export const HISTORY_DAYS = 90;

export async function userDetail(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) return null;

  const [usage, enrolled, history, sessions] = await Promise.all([
    usageFor(user.id, user),
    db.select().from(devices).where(and(eq(devices.userId, user.id), isNull(devices.revokedAt))),
    // `::text` on the day, so the driver hands back a plain calendar string rather than
    // reinterpreting a `date` in the server's timezone. `::int` on the parameter, so Postgres
    // subtracts days from a date instead of reading it as a date and returning the number of
    // days between the two.
    db.execute(sql`
      select local_day::text as day,
             (bytes_up + bytes_down)::bigint as bytes
      from usage_daily
      where user_id = ${user.id}
        and local_day >= (now() at time zone ${user.timezone})::date - ${HISTORY_DAYS}::int
      order by local_day
    `),
    db
      .select()
      .from(tunnelSessions)
      .where(eq(tunnelSessions.userId, user.id))
      .orderBy(desc(tunnelSessions.startedAt))
      .limit(20),
  ]);

  const raw = (Array.isArray(history) ? history : (history.rows ?? [])) as {
    day: string;
    bytes: string;
  }[];

  // The password hash must never leave this function, and the safest way to guarantee that is
  // to never carry it out. Destructured into a discarded binding rather than deleted, so
  // adding a column to `users` cannot quietly start leaking it.
  const { passwordHash, ...safe } = user;
  void passwordHash;

  return {
    user: { ...safe, blocked: user.blockedAt !== null },
    usage,
    devices: enrolled,
    history: raw.map((r) => ({ day: r.day, bytes: Number(r.bytes), users: 1 })),
    sessions,
  };
}
