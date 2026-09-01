/**
 * May this device carry traffic right now?
 *
 * The single decision the whole account system exists to make. It is asked at handshake time
 * and again on every usage report, because the answer changes: an account blocked at 3pm must
 * stop working at 3pm, not when its session happens to expire.
 *
 * # Why this cannot live in the client
 *
 * An API that tells a client "you are over your limit" achieves nothing — the client is
 * untrusted and can simply not ask. The node is the only place with the power to refuse, so the
 * node is where the answer has to arrive. Everything here exists to give it one.
 */

import { and, asc, eq, isNull } from "drizzle-orm";

import { db, devices, users } from "@/db";
import { exceededPeriod, usageFor, type UsageSummary } from "@/lib/usage";

/** Why a device may not connect. Safe to show the person holding it. */
export type DenyReason =
  | "unknown_device"
  | "device_revoked"
  | "device_limit"
  | "blocked"
  | "email_unverified"
  | "over_quota";

export type Decision =
  | {
      allowed: true;
      userId: string;
      deviceId: string;
      email: string;
      timezone: string;
      usage: UsageSummary;
      /** How long the node may trust this answer before asking again. */
      recheckAfterSeconds: number;
    }
  | {
      allowed: false;
      reason: DenyReason;
      message: string;
      /** When the situation might change on its own — a quota reset. Absent for a block. */
      retryAt?: string;
      userId?: string;
    };

/**
 * How long a node may keep carrying traffic on one answer.
 *
 * Sixty seconds is the worst case between blocking an account and its tunnel going down. Longer
 * would make blocking feel broken; much shorter would put a database round trip in front of
 * every minute of every session for no practical gain.
 */
export const RECHECK_SECONDS = 60;

export async function authorizeDevice(publicKey: string, now = new Date()): Promise<Decision> {
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.publicKey, publicKey))
    .limit(1);

  if (!device) {
    return {
      allowed: false,
      reason: "unknown_device",
      message: "This device is not registered to an account. Sign in from the app first.",
    };
  }
  if (device.revokedAt !== null) {
    return {
      allowed: false,
      reason: "device_revoked",
      message: "This device was removed from the account.",
      userId: device.userId,
    };
  }

  const [user] = await db.select().from(users).where(eq(users.id, device.userId)).limit(1);
  if (!user) {
    // A device whose account is gone. The foreign key cascades, so this should be impossible;
    // treating it as unknown rather than throwing means a database oddity cannot take the node
    // down with it.
    return {
      allowed: false,
      reason: "unknown_device",
      message: "This device is not registered to an account.",
    };
  }

  /*
   * Enforced here, on the node's path, and not only in the UI.
   *
   * "You must verify your email" is worth nothing if the only thing checking is the client,
   * because the client is untrusted and can simply not ask. This is the check that actually
   * stops an unverified account from carrying traffic.
   */
  if (user.emailVerifiedAt === null) {
    return {
      allowed: false,
      reason: "email_unverified",
      message:
        "Confirm your email address before connecting. Check your inbox for the link, or ask " +
        "for a new one from the app.",
      userId: user.id,
    };
  }

  if (user.blockedAt !== null) {
    return {
      allowed: false,
      reason: "blocked",
      message: user.blockedReason
        ? `This account is blocked: ${user.blockedReason}`
        : "This account is blocked.",
      userId: user.id,
    };
  }

  /*
   * Enforcing the device limit here as well as at enrolment.
   *
   * Enrolment cannot be the only check, because an admin may *lower* the limit afterwards.
   * Oldest devices win — deterministic, and it means the machine someone has been using all
   * along keeps working while the newest one stops, which is the less surprising outcome.
   */
  const active = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, user.id), isNull(devices.revokedAt)))
    .orderBy(asc(devices.createdAt));

  const rank = active.findIndex((d) => d.id === device.id);
  if (rank >= user.deviceLimit) {
    return {
      allowed: false,
      reason: "device_limit",
      message: `This account allows ${user.deviceLimit} device${
        user.deviceLimit === 1 ? "" : "s"
      }, and this is not one of them. Remove another device, or ask for the limit to be raised.`,
      userId: user.id,
    };
  }

  const usage = await usageFor(user.id, user, now);
  const over = exceededPeriod(usage);
  if (over) {
    return {
      allowed: false,
      reason: "over_quota",
      message: `The ${over.kind} bandwidth limit has been reached. It resets ${over.resetsAt.toISOString()}.`,
      retryAt: over.resetsAt.toISOString(),
      userId: user.id,
    };
  }

  return {
    allowed: true,
    userId: user.id,
    deviceId: device.id,
    email: user.email,
    timezone: user.timezone,
    usage,
    recheckAfterSeconds: RECHECK_SECONDS,
  };
}
