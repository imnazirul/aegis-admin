/**
 * One shape for every response this API gives.
 *
 * Two clients consume it — a Tauri desktop app and a VPN node — neither of which is a browser
 * that a human is watching. A consistent error shape is what lets them tell "wrong password"
 * from "rate limited" from "the database is down" without parsing prose.
 */

import { ZodError, type ZodType } from "zod";

/** A machine-readable reason. The client switches on this; the message is for people. */
export type ErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "email_taken"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "device_limit_reached"
  | "blocked"
  | "server_error";

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  invalid_credentials: 401,
  email_taken: 409,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  device_limit_reached: 409,
  blocked: 403,
  server_error: 500,
};

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function fail(code: ErrorCode, message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: code, message, ...extra }, { status: STATUS[code] });
}

/**
 * Parse and validate a JSON body.
 *
 * Returns the error response rather than throwing, so a handler reads as a sequence of guards
 * instead of a try/catch wrapped around its whole body.
 */
export async function readJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ data: T; error?: never } | { data?: never; error: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: fail("invalid_request", "expected a JSON body") };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { error: fail("invalid_request", describe(parsed.error)) };
  }
  return { data: parsed.data };
}

/** The first problem, in words, rather than Zod's full tree. */
function describe(error: ZodError): string {
  const first = error.issues[0];
  if (!first) return "invalid request";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

/**
 * The caller's address, for rate limiting.
 *
 * Behind Vercel this is `x-forwarded-for`. **It is only trustworthy because a proxy we control
 * sets it** — anywhere the app is reachable directly, a client can put whatever it likes there
 * and rate limiting by it becomes decorative. Never use it for authorization.
 */
export function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
