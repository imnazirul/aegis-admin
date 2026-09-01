/**
 * POST /api/admin/login
 *
 * Rate limited on both the email and the caller's address, like the user path, and for the same
 * reasons. Admin sessions are much shorter — twelve hours rather than thirty days — because a
 * stolen one can block accounts and lift limits.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { admins, db } from "@/db";
import { setAdminCookie } from "@/lib/auth/admin";
import { burnTimeLikeAVerify, verifyPassword } from "@/lib/auth/password";
import { createAdminSession } from "@/lib/auth/sessions";
import { callerIp, fail, ok, readJson } from "@/lib/http";
import { clearFailures, isRateLimited, recordFailure } from "@/lib/rate-limit";

const Body = z.object({ email: z.string().max(320), password: z.string().max(1000) });

export async function POST(request: Request) {
  const { data, error } = await readJson(request, Body);
  if (error) return error;

  const email = data.email.trim().toLowerCase();
  const ip = callerIp(request);

  if ((await isRateLimited("login:email", email)) || (await isRateLimited("login:ip", ip))) {
    return fail("rate_limited", "too many attempts; wait a few minutes");
  }

  const [admin] = await db.select().from(admins).where(eq(admins.email, email)).limit(1);
  const okPassword = admin
    ? await verifyPassword(admin.passwordHash, data.password)
    : (await burnTimeLikeAVerify(), false);

  if (!admin || !okPassword) {
    await recordFailure("login:email", email);
    await recordFailure("login:ip", ip);
    return fail("invalid_credentials", "that email and password do not match");
  }

  await clearFailures("login:email", email);
  await db.update(admins).set({ lastLoginAt: new Date() }).where(eq(admins.id, admin.id));

  const session = await createAdminSession(admin.id);
  await setAdminCookie(session.token, session.expiresAt);

  return ok({ admin: { id: admin.id, email: admin.email, name: admin.name } });
}
