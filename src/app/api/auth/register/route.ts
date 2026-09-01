/**
 * POST /api/auth/register — create an account.
 *
 * Called by the desktop client, never by a browser, so it answers with a bearer token rather
 * than setting a cookie.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, users } from "@/db";
import { MAX_PASSWORD, MIN_PASSWORD, hashPassword } from "@/lib/auth/password";
import { createUserSession } from "@/lib/auth/sessions";
import { callerIp, fail, ok, readJson } from "@/lib/http";
import { isMailConfigured } from "@/lib/mail";
import { isValidTimeZone } from "@/lib/period";
import { isRateLimited, recordFailure } from "@/lib/rate-limit";
import { sendVerification } from "@/lib/verification";

const Body = z.object({
  email: z.email().max(320),
  password: z.string().min(MIN_PASSWORD).max(MAX_PASSWORD),
  /**
   * The client reports the machine's own zone. It decides when this user's quota resets, and
   * afterwards only an admin may change it — a user who could set their own could jump forward
   * a few hours near their daily limit and get an early reset.
   */
  timezone: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  const ip = callerIp(request);
  if (await isRateLimited("register:ip", ip)) {
    return fail("rate_limited", "too many accounts created from this address; try again later");
  }

  // Checked before anything is written. Creating an account nobody can ever verify — because
  // the server cannot send the email — is worse than refusing the sign-up outright: the user
  // waits for a message that was never sent, and the operator hears about it from a complaint.
  if (!isMailConfigured()) {
    return fail(
      "server_error",
      "This server cannot send email yet, so new accounts cannot be verified. " +
        "Set SMTP_HOST, SMTP_USER and SMTP_PASS and try again.",
    );
  }

  const { data, error } = await readJson(request, Body);
  if (error) return error;

  const email = data.email.trim().toLowerCase();
  const timezone = data.timezone && isValidTimeZone(data.timezone) ? data.timezone : "UTC";

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    // Registration cannot hide that an email is taken — the user has to be told to sign in
    // instead. Rate limiting above is what stops it becoming a way to enumerate accounts.
    await recordFailure("register:ip", ip);
    return fail("email_taken", "an account with that email already exists");
  }

  const [created] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(data.password), timezone })
    .returning({ id: users.id, email: users.email, timezone: users.timezone });

  if (!created) return fail("server_error", "could not create the account");

  try {
    await sendVerification(created.id, created.email);
  } catch (e) {
    // The account exists but the email did not go. Removing it would be worse — the address
    // would then be free for someone else to claim — so it stays, unverified and unable to
    // connect, and the answer says exactly that so the client can offer to resend.
    return fail(
      "server_error",
      `Your account was created, but the confirmation code could not be sent: ${
        e instanceof Error ? e.message : "unknown error"
      }. Sign in and ask for a new one.`,
    );
  }

  // Signed in immediately, but unable to connect until the address is confirmed. Signing them
  // in is what lets the app show "check your email" and offer a resend, rather than dropping
  // them back at a login form with nothing to do.
  const session = await createUserSession(created.id, request.headers.get("user-agent"));
  return ok(
    {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: { id: created.id, email: created.email, timezone: created.timezone },
      emailVerified: false,
    },
    { status: 201 },
  );
}
