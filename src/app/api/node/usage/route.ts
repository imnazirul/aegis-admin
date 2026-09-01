/**
 * POST /api/node/usage — the node reports what it carried, and is told who to cut off.
 *
 * One endpoint doing two things, deliberately. The node has to report usage periodically
 * anyway; making the reply carry a fresh verdict per device means blocking somebody takes
 * effect on the next flush rather than needing a second polling loop that could drift out of
 * step with this one.
 *
 * The usage is written **before** the verdicts are computed, so a flush that pushes an account
 * over its limit comes back saying so in the same response. Doing it the other way round would
 * always let one extra interval through.
 *
 * # What is lost when a node dies
 *
 * The node holds counters in memory and flushes them every thirty seconds or so. If it crashes
 * between flushes, that traffic is never counted. There is no version of this that is exact
 * without acknowledging every packet, and the cost of exactness is far higher than the cost of
 * losing half a minute of someone's download. Stated here so nobody later assumes these numbers
 * are billing-grade.
 */

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db, devices, users } from "@/db";
import { authorizeDevice, type Decision } from "@/lib/authorize";
import { fail, ok, readJson } from "@/lib/http";
import { requireNode, touchNode } from "@/lib/node-auth";
import { localDay } from "@/lib/period";
import { addUsage } from "@/lib/usage";

/** How many devices one report may cover. A node with more flushes in batches. */
const MAX_REPORTS = 500;

const Report = z.object({
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  /**
   * Bytes since that device's previous report, not a running total.
   *
   * A delta rather than a cumulative figure because the node restarts and its counters reset;
   * a cumulative value would then go backwards and either subtract from someone's usage or
   * have to be ignored, and neither is a good outcome.
   */
  bytesUp: z.number().int().min(0),
  bytesDown: z.number().int().min(0),
});

const Body = z.object({
  reports: z.array(Report).max(MAX_REPORTS),
  /** When the node measured this. Defaults to now; a late flush still lands on the right day. */
  at: z.iso.datetime().optional(),
});

export async function POST(request: Request) {
  const { node, response } = await requireNode(request);
  if (response) return response;

  const { data, error } = await readJson(request, Body);
  if (error) return error;

  const at = data.at ? new Date(data.at) : new Date();
  if (Number.isNaN(at.getTime())) return fail("invalid_request", "at is not a valid timestamp");

  /*
   * Merge duplicates before writing anything.
   *
   * A node that reported the same device twice in one batch must have both amounts counted,
   * not the last one — and merging first also means one database write per device rather than
   * one per report.
   */
  const totals = new Map<string, { up: number; down: number }>();
  for (const report of data.reports) {
    const running = totals.get(report.publicKey) ?? { up: 0, down: 0 };
    running.up += report.bytesUp;
    running.down += report.bytesDown;
    totals.set(report.publicKey, running);
  }

  if (totals.size === 0) {
    await touchNode(node.id);
    return ok({ verdicts: [] });
  }

  // One lookup for the whole batch. The user's timezone comes with it, because that is what
  // decides which calendar day this traffic belongs to.
  const known = await db
    .select({
      deviceId: devices.id,
      publicKey: devices.publicKey,
      userId: users.id,
      timezone: users.timezone,
    })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(inArray(devices.publicKey, [...totals.keys()]));

  const byKey = new Map(known.map((d) => [d.publicKey, d]));
  const verdicts: (Decision & { publicKey: string })[] = [];

  for (const [publicKey, amount] of totals) {
    const device = byKey.get(publicKey);

    if (!device) {
      // Usage for a device we have never seen. Recorded nowhere — there is no account to
      // attribute it to — but the node is told so it stops carrying it.
      verdicts.push({
        publicKey,
        allowed: false,
        reason: "unknown_device",
        message: "This device is not registered to an account.",
      });
      continue;
    }

    if (amount.up > 0 || amount.down > 0) {
      // Bucketed by the *user's* local day, which is what makes their limits reset at their
      // own midnight rather than the server's.
      await addUsage(device.userId, localDay(at, device.timezone), amount.up, amount.down);
    }

    // After the write, so this reflects the traffic just reported.
    verdicts.push({ publicKey, ...(await authorizeDevice(publicKey, at)) });
  }

  const seen = [...byKey.values()].map((d) => d.deviceId);
  if (seen.length > 0) {
    await db.update(devices).set({ lastSeenAt: at }).where(inArray(devices.id, seen));
  }

  await touchNode(node.id);
  return ok({ verdicts });
}
