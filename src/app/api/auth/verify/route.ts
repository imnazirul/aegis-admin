/**
 * POST /api/auth/verify — submit the code from the email.
 *
 * Authenticated, so a code is only ever checked against the account that asked for it. That is
 * what makes a six-digit code safe to use at all: there is no global lookup, so guessing has to
 * be aimed at one account, against a five-attempt cap.
 */

import { z } from "zod";

import { authenticateUser } from "@/lib/auth/sessions";
import { fail, ok, readJson } from "@/lib/http";
import { MAX_ATTEMPTS, verifyCode } from "@/lib/verification";

const Body = z.object({
  /** Digits. Spaces and dashes are stripped, because people paste what they see. */
  code: z.string().min(1).max(20),
});

export async function POST(request: Request) {
  const user = await authenticateUser(request);
  if (!user) return fail("unauthorized", "sign in first");

  const { data, error } = await readJson(request, Body);
  if (error) return error;

  const outcome = await verifyCode(user.id, data.code);
  if (outcome.ok) {
    return ok({ verified: true, already: outcome.already });
  }

  switch (outcome.reason) {
    case "expired":
      return fail("invalid_request", "That code has expired. Ask for a new one.");
    case "too_many_attempts":
      return fail(
        "rate_limited",
        `That is ${MAX_ATTEMPTS} wrong attempts, so the code is no longer valid. Ask for a new one.`,
      );
    default:
      return fail(
        "invalid_request",
        outcome.remaining === undefined
          ? "That code is not right. Ask for a new one."
          : `That code is not right. ${outcome.remaining} attempt${
              outcome.remaining === 1 ? "" : "s"
            } left.`,
      );
  }
}
