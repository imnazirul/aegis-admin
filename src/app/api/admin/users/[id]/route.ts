/**
 * One user: everything about them, and the controls that change it.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, users } from "@/db";
import { userDetail } from "@/lib/admin-user";
import { record, requireAdmin } from "@/lib/auth/admin";
import { revokeAllUserSessions } from "@/lib/auth/sessions";
import { fail, ok, readJson } from "@/lib/http";
import { isValidTimeZone } from "@/lib/period";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  const detail = await userDetail(id);
  if (!detail) return fail("not_found", "no such user");
  return ok(detail);
}

/**
 * What an admin may change.
 *
 * `null` for a limit means unlimited, and is different from omitting the field, which means
 * "leave it alone". `.nullable().optional()` is what keeps those two apart — without it there
 * is no way to *clear* a limit.
 */
const Patch = z.object({
  timezone: z.string().max(64).optional(),
  deviceLimit: z.number().int().min(1).max(50).optional(),
  dailyLimitBytes: z.number().int().min(0).nullable().optional(),
  weeklyLimitBytes: z.number().int().min(0).nullable().optional(),
  monthlyLimitBytes: z.number().int().min(0).nullable().optional(),
  blocked: z.boolean().optional(),
  blockedReason: z.string().max(500).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { admin, response } = await requireAdmin();
  if (response) return response;

  const { id } = await params;
  const { data, error } = await readJson(request, Patch);
  if (error) return error;

  const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!existing) return fail("not_found", "no such user");

  if (data.timezone !== undefined && !isValidTimeZone(data.timezone)) {
    return fail("invalid_request", `${data.timezone} is not a known timezone`);
  }

  const changes: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (data.timezone !== undefined) changes.timezone = data.timezone;
  if (data.deviceLimit !== undefined) changes.deviceLimit = data.deviceLimit;
  if (data.dailyLimitBytes !== undefined) changes.dailyLimitBytes = data.dailyLimitBytes;
  if (data.weeklyLimitBytes !== undefined) changes.weeklyLimitBytes = data.weeklyLimitBytes;
  if (data.monthlyLimitBytes !== undefined) changes.monthlyLimitBytes = data.monthlyLimitBytes;
  if (data.blockedReason !== undefined) changes.blockedReason = data.blockedReason;

  if (data.blocked !== undefined) {
    changes.blockedAt = data.blocked ? (existing.blockedAt ?? new Date()) : null;
    if (!data.blocked) changes.blockedReason = null;
  }

  const [updated] = await db.update(users).set(changes).where(eq(users.id, id)).returning();
  if (!updated) return fail("server_error", "could not update the user");

  // Blocking must end their sessions, not merely stop the next sign-in. Leaving a session alive
  // would let a blocked account keep talking to the API — and, once the node consults us, keep
  // its tunnel up until that session happened to expire.
  if (data.blocked === true && existing.blockedAt === null) {
    await revokeAllUserSessions(id);
  }

  await record(
    admin.id,
    data.blocked === true ? "user.block" : data.blocked === false ? "user.unblock" : "user.update",
    id,
    data,
  );

  return ok({ user: { ...updated, passwordHash: undefined, blocked: updated.blockedAt !== null } });
}
