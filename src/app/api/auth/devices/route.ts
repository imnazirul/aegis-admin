/**
 * The machines enrolled to an account.
 *
 * A device is identified by its X25519 public key — the same identity the VPN node already
 * authenticates cryptographically. Enrolling it here is what tells the node whose traffic it is
 * carrying. The private half never leaves the machine and is never sent.
 */

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, devices } from "@/db";
import { authenticateUser } from "@/lib/auth/sessions";
import { fail, ok, readJson } from "@/lib/http";

const Body = z.object({
  /** 32 bytes, hex encoded. */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters"),
  name: z.string().max(100).optional(),
});

export async function GET(request: Request) {
  const user = await authenticateUser(request);
  if (!user) return fail("unauthorized", "sign in first");

  const enrolled = await db
    .select({
      id: devices.id,
      name: devices.name,
      publicKey: devices.publicKey,
      lastSeenAt: devices.lastSeenAt,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .where(and(eq(devices.userId, user.id), isNull(devices.revokedAt)));

  return ok({ devices: enrolled, deviceLimit: user.deviceLimit });
}

export async function POST(request: Request) {
  const user = await authenticateUser(request);
  if (!user) return fail("unauthorized", "sign in first");

  const { data, error } = await readJson(request, Body);
  if (error) return error;

  const [existing] = await db
    .select()
    .from(devices)
    .where(eq(devices.publicKey, data.publicKey))
    .limit(1);

  if (existing) {
    // A device key is globally unique, so someone else's key is a conflict rather than a new
    // enrolment. Reported as "not found" so a key cannot be probed for existence.
    if (existing.userId !== user.id) {
      return fail("not_found", "that device key is not available");
    }
    // Our own key again. Re-enrolling is how a client recovers after reinstalling, so it
    // un-revokes and updates the name rather than failing.
    const [revived] = await db
      .update(devices)
      .set({ revokedAt: null, name: data.name ?? existing.name })
      .where(eq(devices.id, existing.id))
      .returning();
    return ok({ device: revived });
  }

  const active = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, user.id), isNull(devices.revokedAt)));

  if (active.length >= user.deviceLimit) {
    return fail(
      "device_limit_reached",
      `this account allows ${user.deviceLimit} device${user.deviceLimit === 1 ? "" : "s"}. ` +
        "Remove one, or ask for the limit to be raised.",
      { deviceLimit: user.deviceLimit, enrolled: active.length },
    );
  }

  const [created] = await db
    .insert(devices)
    .values({ userId: user.id, publicKey: data.publicKey, name: data.name ?? "" })
    .returning();

  return ok({ device: created }, { status: 201 });
}
