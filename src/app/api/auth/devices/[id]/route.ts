/**
 * DELETE /api/auth/devices/:id — retire a device.
 *
 * Revoked rather than deleted, so the tunnel sessions it recorded keep pointing at something.
 * A revoked device no longer counts against the account's limit and the node will refuse it.
 */

import { and, eq } from "drizzle-orm";

import { db, devices } from "@/db";
import { authenticateUser } from "@/lib/auth/sessions";
import { fail, ok } from "@/lib/http";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateUser(request);
  if (!user) return fail("unauthorized", "sign in first");

  const { id } = await params;

  // Scoped to the caller's own devices, so someone else's id is indistinguishable from one that
  // never existed.
  const [revoked] = await db
    .update(devices)
    .set({ revokedAt: new Date() })
    .where(and(eq(devices.id, id), eq(devices.userId, user.id)))
    .returning({ id: devices.id });

  if (!revoked) return fail("not_found", "no such device");
  return ok({ revoked: revoked.id });
}
