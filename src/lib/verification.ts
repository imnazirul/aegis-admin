/**
 * Email verification.
 *
 * An account exists the moment it is created, but it cannot carry traffic until its address is
 * confirmed — the check lives in `authorize.ts`, so it is the *node* that refuses, not merely
 * the UI. That matters: a client is untrusted and can simply not ask.
 */

import { and, eq, gt, isNull } from "drizzle-orm";

import { db, emailVerifications, users } from "@/db";
import { hashToken, newToken } from "@/lib/auth/tokens";
import { appUrl, send, verificationMail } from "@/lib/mail";

/** How long a verification link lasts. */
export const VALID_HOURS = 24;

/**
 * Issue a link and email it.
 *
 * Any previous unused link for the account is invalidated first, so a resend cannot leave two
 * working tokens in flight — the newest is the only one that opens the door.
 *
 * @throws if the mail cannot be sent. The caller decides whether that is fatal.
 */
export async function sendVerification(
  userId: string,
  email: string,
  request?: Request,
): Promise<void> {
  await db
    .update(emailVerifications)
    .set({ usedAt: new Date() })
    .where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.usedAt)));

  const token = newToken();
  await db.insert(emailVerifications).values({
    userId,
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VALID_HOURS * 60 * 60 * 1000),
  });

  const link = `${appUrl(request)}/verify?token=${encodeURIComponent(token)}`;
  await send(verificationMail(email, link, VALID_HOURS));
}

/** What happened when someone opened a verification link. */
export type VerifyOutcome =
  | { ok: true; email: string; already: boolean }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Consume a verification token.
 *
 * An unknown token and an already-used one are the same answer, deliberately: telling them
 * apart would let someone probe which tokens once existed.
 */
export async function verify(token: string): Promise<VerifyOutcome> {
  if (!token) return { ok: false, reason: "invalid" };

  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(eq(emailVerifications.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return { ok: false, reason: "invalid" };

  const [user] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  if (!user) return { ok: false, reason: "invalid" };

  // Already verified: say so plainly rather than failing. People click the link twice, and an
  // error on the second click reads as "it did not work".
  if (user.emailVerifiedAt !== null) {
    return { ok: true, email: user.email, already: true };
  }

  if (row.usedAt !== null) return { ok: false, reason: "invalid" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  // The address must still be the one the link was sent to. Otherwise changing an email would
  // leave a link in flight that verifies an address the account no longer has.
  if (row.email !== user.email) return { ok: false, reason: "invalid" };

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));
  await db
    .update(emailVerifications)
    .set({ usedAt: new Date() })
    .where(eq(emailVerifications.id, row.id));

  return { ok: true, email: user.email, already: false };
}

/** Whether a fresh link may be sent, or how long to wait. */
export async function canResend(userId: string): Promise<{ ok: true } | { ok: false; wait: number }> {
  const [recent] = await db
    .select({ createdAt: emailVerifications.createdAt })
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.userId, userId),
        gt(emailVerifications.createdAt, new Date(Date.now() - 60_000)),
      ),
    )
    .limit(1);

  if (!recent) return { ok: true };
  // One a minute. Enough that a genuine "it did not arrive" is quick to retry, and slow enough
  // that this endpoint cannot be used to send someone a hundred emails.
  const wait = Math.ceil((60_000 - (Date.now() - recent.createdAt.getTime())) / 1000);
  return { ok: false, wait: Math.max(wait, 1) };
}
