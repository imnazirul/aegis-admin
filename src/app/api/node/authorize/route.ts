/**
 * POST /api/node/authorize — asked once per handshake.
 *
 * The node has already proved, cryptographically, that it is talking to the holder of this
 * device key. What it cannot know is whose key it is, whether that account is blocked, and
 * whether they have any bandwidth left. That is what this answers.
 */

import { z } from "zod";

import { authorizeDevice } from "@/lib/authorize";
import { ok, readJson } from "@/lib/http";
import { requireNode, touchNode } from "@/lib/node-auth";

const Body = z.object({
  publicKey: z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters"),
});

export async function POST(request: Request) {
  const { node, response } = await requireNode(request);
  if (response) return response;

  const { data, error } = await readJson(request, Body);
  if (error) return error;

  const decision = await authorizeDevice(data.publicKey);
  await touchNode(node.id);

  // A refusal is a 200 with `allowed: false`, not a 403. The node's *request* was perfectly
  // valid and correctly authenticated; the answer is simply no. Using an HTTP error would make
  // "this device may not connect" indistinguishable from "your node token is wrong", and the
  // node must treat those completely differently.
  return ok(decision);
}
