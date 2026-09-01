/**
 * Admin authentication, and the record of what admins did.
 *
 * A cookie rather than a bearer token, because this side is a browser. `httpOnly` so no script
 * on the page can read it, `sameSite: lax` so another site cannot make a state-changing request
 * with it attached, and `secure` everywhere but local development.
 */

import { cookies } from "next/headers";

import { auditLog, db } from "@/db";
import { fail } from "@/lib/http";
import { ADMIN_COOKIE, authenticateAdminToken, type Admin } from "./sessions";

/** The signed-in admin, or `null`. */
export async function currentAdmin(): Promise<Admin | null> {
  const store = await cookies();
  return authenticateAdminToken(store.get(ADMIN_COOKIE)?.value);
}

/**
 * The signed-in admin, or a response to return.
 *
 * Returning the failure rather than throwing keeps a handler reading as a list of guards, and
 * makes it impossible to forget the check — there is no way to reach the admin without also
 * having handled its absence.
 */
export async function requireAdmin(): Promise<
  { admin: Admin; response?: never } | { admin?: never; response: Response }
> {
  const admin = await currentAdmin();
  if (!admin) return { response: fail("unauthorized", "sign in to the admin panel") };
  return { admin };
}

export async function setAdminCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearAdminCookie(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}

/**
 * Record an administrative action.
 *
 * Blocking someone, raising a limit or changing a timezone are all decisions that may need
 * explaining later — sometimes to the person they were done to. Failing to write the log must
 * never fail the action itself, so this swallows its own errors: a missing audit line is bad,
 * an unblock that reports failure after succeeding is worse.
 */
export async function record(
  adminId: string,
  action: string,
  targetUserId: string | null,
  detail?: unknown,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      adminId,
      action,
      targetUserId,
      detail: detail === undefined ? null : (detail as object),
    });
  } catch {
    // Intentionally ignored; see above.
  }
}
