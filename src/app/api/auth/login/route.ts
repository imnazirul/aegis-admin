/**
 * POST /api/auth/login — exchange an email and password for a session token.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, users } from "@/db";
import { burnTimeLikeAVerify, verifyPassword } from "@/lib/auth/password";
import { createUserSession } from "@/lib/auth/sessions";
import { callerIp, fail, ok, readJson } from "@/lib/http";
import { clearFailures, isRateLimited, recordFailure, retryAfterSeconds } from "@/lib/rate-limit";

const Body = z.object({
  email: z.string().max(320),
  password: z.string().max(1000),
});

export async function POST(request: Request) {
  const { data, error } = await readJson(request, Body);
  if (error) return error;

  const email = data.email.trim().toLowerCase();
  const ip = callerIp(request);

  // Both keys, because they stop different attacks: the email key stops a password list against
  // one account, the address key stops one guess sprayed across many accounts.
  if ((await isRateLimited("login:email", email)) || (await isRateLimited("login:ip", ip))) {
    return fail("rate_limited", "too many attempts; wait a few minutes", {
      retryAfter: retryAfterSeconds("login:email"),
    });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Spend the same time whether or not the email exists. Without this, "no such account"
  // returns in a millisecond and "wrong password" in fifty, which is a reliable way to find out
  // who has an account here.
  const okPassword = user
    ? await verifyPassword(user.passwordHash, data.password)
    : (await burnTimeLikeAVerify(), false);

  if (!user || !okPassword) {
    await recordFailure("login:email", email);
    await recordFailure("login:ip", ip);
    // One message for both cases, for the same reason.
    return fail("invalid_credentials", "that email and password do not match");
  }

  await clearFailures("login:email", email);

  const session = await createUserSession(user.id, request.headers.get("user-agent"));
  return ok({
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: {
      id: user.id,
      email: user.email,
      timezone: user.timezone,
      // Told at sign-in, so the client can explain itself rather than just failing to connect.
      blocked: user.blockedAt !== null,
      blockedReason: user.blockedReason,
      emailVerified: user.emailVerifiedAt !== null,
    },
  });
}
