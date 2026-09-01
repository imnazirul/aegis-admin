/**
 * Who is making this request.
 *
 * Users and admins have separate tables, separate session tables and separate functions here.
 * Nothing in the user path can produce an admin session, which is the point: a bug in the code
 * that handles anonymous registration should not be one step away from an account that can
 * unblock people.
 */

import { and, eq, gt, lt } from "drizzle-orm";

import { adminSessions, admins, db, userSessions, users } from "@/db";
import {
  ADMIN_SESSION_HOURS,
  USER_SESSION_DAYS,
  bearerToken,
  expiresIn,
  expiresInHours,
  hashToken,
  newToken,
} from "./tokens";

export type User = typeof users.$inferSelect;
export type Admin = typeof admins.$inferSelect;

/** How stale `last_used_at` may get before we spend a write updating it. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Users — the desktop client
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Start a session and return the token.
 *
 * This is the only moment the token exists in a readable form. It is returned to the caller and
 * never stored, so if it is lost the user signs in again.
 */
export async function createUserSession(
  userId: string,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = expiresIn(USER_SESSION_DAYS);
  await db.insert(userSessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: userAgent?.slice(0, 500) ?? null,
  });
  return { token, expiresAt };
}

/**
 * Resolve a request's bearer token to the user it belongs to.
 *
 * `null` for anything wrong — absent, malformed, unknown, expired. The caller cannot tell those
 * apart and should not: distinguishing "no such token" from "expired token" tells an attacker
 * which of their guesses was once real.
 *
 * A blocked user still authenticates. Blocking stops them *using the VPN*, and they still need
 * to be able to sign in and be told why.
 */
export async function authenticateUser(request: Request): Promise<User | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const rows = await db
    .select({ user: users, sessionId: userSessions.id, lastUsedAt: userSessions.lastUsedAt })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(
      and(eq(userSessions.tokenHash, hashToken(token)), gt(userSessions.expiresAt, new Date())),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Written lazily. Updating it on every request would turn a read-only endpoint into a write
  // to the same row from every device the user has, for information nobody reads to the hour.
  const stale = !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > TOUCH_AFTER_MS;
  if (stale) {
    await db
      .update(userSessions)
      .set({ lastUsedAt: new Date() })
      .where(eq(userSessions.id, row.sessionId));
  }

  return row.user;
}

/** End one session. Signing out on one machine leaves the others alone. */
export async function revokeUserSession(request: Request): Promise<void> {
  const token = bearerToken(request);
  if (!token) return;
  await db.delete(userSessions).where(eq(userSessions.tokenHash, hashToken(token)));
}

/** End every session for a user — what a password change or an admin block should do. */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.userId, userId));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Admins — this panel
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The cookie the admin panel authenticates with. */
export const ADMIN_COOKIE = "aegis_admin";

export async function createAdminSession(
  adminId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = expiresInHours(ADMIN_SESSION_HOURS);
  await db.insert(adminSessions).values({ adminId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

/** Resolve an admin session token. Same rules as above: `null` for anything wrong. */
export async function authenticateAdminToken(token: string | undefined): Promise<Admin | null> {
  if (!token) return null;
  const rows = await db
    .select({ admin: admins })
    .from(adminSessions)
    .innerJoin(admins, eq(admins.id, adminSessions.adminId))
    .where(
      and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, new Date())),
    )
    .limit(1);
  return rows[0]?.admin ?? null;
}

export async function revokeAdminSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Housekeeping
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Delete sessions that have expired.
 *
 * Expiry is already enforced on every lookup, so this is only to stop the tables growing
 * without bound. Safe to call from anywhere, at any time, and safe to never call.
 */
export async function pruneExpiredSessions(): Promise<void> {
  const now = new Date();
  await db.delete(userSessions).where(lt(userSessions.expiresAt, now));
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
}

/** Whether this account is allowed to use the VPN at all. */
export function isBlocked(user: Pick<User, "blockedAt">): boolean {
  return user.blockedAt !== null;
}
