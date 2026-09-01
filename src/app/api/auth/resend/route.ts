/**
 * POST /api/auth/resend — send a fresh confirmation link.
 *
 * Requires a session, so it cannot be used to send mail to an address the caller does not
 * control. Rate limited to one a minute, which is quick enough for a genuine "it never arrived"
 * and slow enough that this is not a way to post someone a hundred emails.
 */

import { authenticateUser } from "@/lib/auth/sessions";
import { fail, ok } from "@/lib/http";
import { canResend, sendVerification } from "@/lib/verification";

export async function POST(request: Request) {
  const user = await authenticateUser(request);
  if (!user) return fail("unauthorized", "sign in first");

  if (user.emailVerifiedAt !== null) {
    return ok({ sent: false, alreadyVerified: true });
  }

  const allowed = await canResend(user.id);
  if (!allowed.ok) {
    return fail("rate_limited", `Wait ${allowed.wait} seconds before asking for another email.`);
  }

  try {
    await sendVerification(user.id, user.email, request);
  } catch (e) {
    return fail(
      "server_error",
      `Could not send the email: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }
  return ok({ sent: true, to: user.email });
}
