/**
 * Authenticating a VPN node.
 *
 * A node is not a user and not an admin. It is a machine we operate, holding a long service
 * token, and it speaks for *other* people — which is exactly why it gets its own credential and
 * its own table rather than an account with a flag.
 *
 * Only the SHA-256 hash of the token is stored, and it is looked up by index — the same shape
 * as a user or admin session. A 256-bit random token cannot be guessed, so there is nothing a
 * timing difference in an indexed lookup could reveal that matters.
 */

import { eq } from "drizzle-orm";

import { db, nodes } from "@/db";
import { fail } from "@/lib/http";
import { bearerToken, hashToken } from "@/lib/auth/tokens";

export type Node = typeof nodes.$inferSelect;

export async function authenticateNode(request: Request): Promise<Node | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const [node] = await db
    .select()
    .from(nodes)
    .where(eq(nodes.tokenHash, hashToken(token)))
    .limit(1);
  return node ?? null;
}

/** The node, or a response to return. */
export async function requireNode(
  request: Request,
): Promise<{ node: Node; response?: never } | { node?: never; response: Response }> {
  const node = await authenticateNode(request);
  if (!node) return { response: fail("unauthorized", "unknown or missing node token") };
  return { node };
}

/** Note that a node is alive, for the dashboard. Never worth failing a request over. */
export async function touchNode(id: string): Promise<void> {
  try {
    await db.update(nodes).set({ lastSeenAt: new Date() }).where(eq(nodes.id, id));
  } catch {
    // Ignored on purpose.
  }
}
