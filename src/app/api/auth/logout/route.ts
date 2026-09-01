/**
 * POST /api/auth/logout — end this session only.
 *
 * Always answers 204, whether or not the token was valid. There is nothing useful to say, and
 * "that token was already invalid" is information not worth giving away.
 */

import { revokeUserSession } from "@/lib/auth/sessions";

export async function POST(request: Request) {
  await revokeUserSession(request);
  return new Response(null, { status: 204 });
}
