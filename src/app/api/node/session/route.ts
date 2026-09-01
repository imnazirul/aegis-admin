/**
 * POST /api/node/session — a tunnel started or ended.
 *
 * Separate from usage reporting because it is a different shape of event: usage is a stream of
 * amounts, this is a pair of moments. Keeping them apart means a node that drops a session
 * event still reports usage correctly, and vice versa.
 *
 * These rows are for support and abuse investigation — "when was this account last connected,
 * and from which node" — and for the dashboard's live count. Quota never reads them; that comes
 * from `usage_daily` alone, so a lost session event can never affect anyone's limit.
 */

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, devices, tunnelSessions, users } from "@/db";
import { fail, ok, readJson } from "@/lib/http";
import { requireNode, touchNode } from "@/lib/node-auth";

const Body = z.object({
  publicKey: z.string().regex(/^[0-9a-f]{64}$/),
  event: z.enum(["start", "end"]),
  /** The tunnel address the node leased, for support questions. */
  assignedIp: z.string().max(45).optional(),
  at: z.iso.datetime().optional(),
});

export async function POST(request: Request) {
  const { node, response } = await requireNode(request);
  if (response) return response;

  const { data, error } = await readJson(request, Body);
  if (error) return error;

  const at = data.at ? new Date(data.at) : new Date();
  if (Number.isNaN(at.getTime())) return fail("invalid_request", "at is not a valid timestamp");

  const [device] = await db
    .select({ id: devices.id, userId: users.id })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(eq(devices.publicKey, data.publicKey))
    .limit(1);

  if (!device) return fail("not_found", "no such device");

  if (data.event === "start") {
    /*
     * Close any session this device left open first.
     *
     * A node that is killed rather than stopped never sends its `end` events, so without this
     * every crash would leave a row that says "still connected" forever — and the dashboard's
     * live count would only ever go up.
     */
    await db
      .update(tunnelSessions)
      .set({ endedAt: at })
      .where(and(eq(tunnelSessions.deviceId, device.id), isNull(tunnelSessions.endedAt)));

    const [started] = await db
      .insert(tunnelSessions)
      .values({
        userId: device.userId,
        deviceId: device.id,
        nodeId: node.id,
        assignedIp: data.assignedIp ?? null,
        startedAt: at,
      })
      .returning({ id: tunnelSessions.id });

    await touchNode(node.id);
    return ok({ sessionId: started?.id ?? null });
  }

  await db
    .update(tunnelSessions)
    .set({ endedAt: at })
    .where(and(eq(tunnelSessions.deviceId, device.id), isNull(tunnelSessions.endedAt)));

  await touchNode(node.id);
  return ok({ ended: true });
}
