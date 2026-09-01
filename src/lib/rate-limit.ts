/**
 * Rate limiting, in Postgres.
 *
 * Not Redis, deliberately: this is a handful of rows a minute at any plausible scale for a
 * personal VPN, and Redis would be another service to run, secure and pay for. When the row
 * count makes that trade worthwhile, this file is the only thing that changes.
 *
 * Two keys are limited on every sign-in attempt, and both matter:
 *
 * - **the email**, which stops someone working through a password list against one account
 * - **the caller's address**, which stops them working through an email list from one machine
 *
 * Limiting only the email lets an attacker spray one guess across thousands of accounts —
 * "password123" against everyone — which is how credential stuffing actually works.
 */

import { and, eq, gt, sql } from "drizzle-orm";

import { db, loginAttempts } from "@/db";

export type LimitKind = "login:email" | "login:ip" | "register:ip";

const LIMITS: Record<LimitKind, { max: number; windowMinutes: number }> = {
  // Generous enough that a person mistyping their password is never locked out.
  "login:email": { max: 10, windowMinutes: 15 },
  // Higher, because a household or an office shares one address.
  "login:ip": { max: 50, windowMinutes: 15 },
  "register:ip": { max: 5, windowMinutes: 60 },
};

/** Whether this key has used up its allowance. */
export async function isRateLimited(kind: LimitKind, key: string): Promise<boolean> {
  const { max, windowMinutes } = LIMITS[kind];
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);

  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.kind, kind), eq(loginAttempts.key, key), gt(loginAttempts.at, since)));

  return (rows[0]?.n ?? 0) >= max;
}

/**
 * Record a failed attempt.
 *
 * Only failures are recorded. Counting successes would lock out the one case we most want to
 * keep working — someone who knows their password and opens the app on three machines.
 */
export async function recordFailure(kind: LimitKind, key: string): Promise<void> {
  await db.insert(loginAttempts).values({ kind, key });
}

/** Forget a key's failures, called on a successful sign-in. */
export async function clearFailures(kind: LimitKind, key: string): Promise<void> {
  await db.delete(loginAttempts).where(and(eq(loginAttempts.kind, kind), eq(loginAttempts.key, key)));
}

/** How long the caller should wait, in seconds — for a `Retry-After` header. */
export function retryAfterSeconds(kind: LimitKind): number {
  return LIMITS[kind].windowMinutes * 60;
}
