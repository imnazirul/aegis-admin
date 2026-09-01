/**
 * Email verification, by code.
 *
 * An account exists the moment it is created, but it cannot carry traffic until its address is
 * confirmed — the check lives in `authorize.ts`, so it is the *node* that refuses, not merely
 * the UI. That matters: a client is untrusted and can simply not ask.
 *
 * # Why a code rather than a link
 *
 * The client is a desktop app. A link in an email opens a browser, which then has to hand the
 * result back to an application it has no connection to. A six-digit code typed into the app
 * keeps the whole flow in one place, and it works when the email is read on a phone.
 *
 * The trade is entropy: six digits is a million possibilities, not 2^256. What makes that safe
 * is not the hashing — six digits fall to a dictionary instantly — but the two limits below.
 * Remove either and the code is guessable.
 */

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";

import { db, emailCodes, users } from "@/db";
import { hashToken } from "@/lib/auth/tokens";
import { send, verificationMail } from "@/lib/mail";

/** How long a code is good for. Short, because a code is guessable in a way a link is not. */
export const VALID_MINUTES = 15;

/**
 * Wrong guesses before the code is burned.
 *
 * The load-bearing protection. A million combinations is an afternoon's work at any useful
 * request rate; five attempts makes it a one-in-two-hundred-thousand shot per code.
 */
export const MAX_ATTEMPTS = 5;

/** A six-digit code, uniformly distributed and cryptographically random. */
function newCode(): string {
  // `randomInt` is rejection-sampled, so every value is equally likely — unlike `% 1000000`
  // over a random integer, which quietly favours the low end.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Issue a code and email it.
 *
 * Any previous unused code is invalidated first, so a resend cannot leave two working codes in
 * flight — the newest is the only one that opens the door.
 *
 * @throws if the mail cannot be sent. The caller decides whether that is fatal.
 */
export async function sendVerification(userId: string, email: string): Promise<void> {
  await db
    .update(emailCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(emailCodes.userId, userId), isNull(emailCodes.usedAt)));

  const code = newCode();
  await db.insert(emailCodes).values({
    userId,
    email,
    codeHash: hashToken(code),
    expiresAt: new Date(Date.now() + VALID_MINUTES * 60 * 1000),
  });

  await send(verificationMail(email, code, VALID_MINUTES));
}

/** What happened when someone submitted a code. */
export type VerifyOutcome =
  | { ok: true; already: boolean }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts"; remaining?: number };

/**
 * Check a code against an account.
 *
 * Scoped to one account — a code is never looked up globally, so two people holding the same
 * six digits at the same time is harmless.
 */
export async function verifyCode(userId: string, code: string): Promise<VerifyOutcome> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { ok: false, reason: "invalid" };

  // Already done: say so plainly rather than failing. People press the button twice.
  if (user.emailVerifiedAt !== null) return { ok: true, already: true };

  const [row] = await db
    .select()
    .from(emailCodes)
    .where(and(eq(emailCodes.userId, userId), isNull(emailCodes.usedAt)))
    .orderBy(sql`${emailCodes.createdAt} desc`)
    .limit(1);

  if (!row) return { ok: false, reason: "invalid" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  // The address must still be the one it was sent to, or changing an email would leave a code
  // in flight that confirms an address the account no longer has.
  const digits = code.replace(/\D/g, "");
  if (row.email !== user.email || hashToken(digits) !== row.codeHash) {
    // Counted before answering, and in the database rather than in memory, so restarting the
    // server does not hand an attacker a fresh five guesses.
    const [updated] = await db
      .update(emailCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(emailCodes.id, row.id))
      .returning({ attempts: emailCodes.attempts });

    const used = updated?.attempts ?? row.attempts + 1;
    if (used >= MAX_ATTEMPTS) {
      // Burned. A fresh code is the only way forward, which is what stops the cap being
      // sidestepped by simply carrying on.
      await db.update(emailCodes).set({ usedAt: new Date() }).where(eq(emailCodes.id, row.id));
      return { ok: false, reason: "too_many_attempts" };
    }
    return { ok: false, reason: "invalid", remaining: MAX_ATTEMPTS - used };
  }

  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));
  await db.update(emailCodes).set({ usedAt: new Date() }).where(eq(emailCodes.id, row.id));

  return { ok: true, already: false };
}

/** Whether a fresh code may be sent, or how long to wait. */
export async function canResend(
  userId: string,
): Promise<{ ok: true } | { ok: false; wait: number }> {
  const [recent] = await db
    .select({ createdAt: emailCodes.createdAt })
    .from(emailCodes)
    .where(
      and(eq(emailCodes.userId, userId), gt(emailCodes.createdAt, new Date(Date.now() - 60_000))),
    )
    .limit(1);

  if (!recent) return { ok: true };
  // One a minute. Quick enough for a genuine "it never arrived", slow enough that this is not
  // a way to post someone a hundred emails — or to farm fresh attempt allowances.
  const wait = Math.ceil((60_000 - (Date.now() - recent.createdAt.getTime())) / 1000);
  return { ok: false, wait: Math.max(wait, 1) };
}
