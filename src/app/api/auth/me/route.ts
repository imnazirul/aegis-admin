/**
 * GET /api/auth/me — everything the desktop client needs to render its own state.
 *
 * One call rather than three, because the client polls this and each extra round trip is a
 * cold serverless function away.
 */

import { and, eq, isNull } from "drizzle-orm";

import { db, devices } from "@/db";
import { authenticateUser } from "@/lib/auth/sessions";
import { fail, ok } from "@/lib/http";
import { usageFor } from "@/lib/usage";

export async function GET(request: Request) {
  const user = await authenticateUser(request);
  if (!user) return fail("unauthorized", "sign in first");

  const [usage, enrolled] = await Promise.all([
    usageFor(user.id, user),
    db
      .select({
        id: devices.id,
        name: devices.name,
        publicKey: devices.publicKey,
        lastSeenAt: devices.lastSeenAt,
        createdAt: devices.createdAt,
      })
      .from(devices)
      .where(and(eq(devices.userId, user.id), isNull(devices.revokedAt))),
  ]);

  return ok({
    user: {
      id: user.id,
      email: user.email,
      timezone: user.timezone,
      deviceLimit: user.deviceLimit,
      blocked: user.blockedAt !== null,
      blockedReason: user.blockedReason,
      emailVerified: user.emailVerifiedAt !== null,
    },
    usage,
    devices: enrolled,
  });
}
