/**
 * Session tokens.
 *
 * A token is 32 random bytes, given to the client once, and stored here only as a SHA-256
 * hash. Two consequences worth being explicit about:
 *
 * - A leaked database dump does not hand anyone a working session.
 * - We cannot show a user their own token again. That is correct; there is no reason to.
 *
 * SHA-256 rather than Argon2, deliberately. Argon2 is slow *on purpose* to make guessing a
 * human-chosen password expensive. A 256-bit random token cannot be guessed at all, so the
 * slowness would buy nothing and cost a hash on every authenticated request.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** How long a desktop client stays signed in without re-entering a password. */
export const USER_SESSION_DAYS = 30;

/** Shorter, because an admin session can block accounts and change limits. */
export const ADMIN_SESSION_HOURS = 12;

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function expiresIn(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function expiresInHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * Compare two hex digests without leaking, through timing, how much of a prefix matched.
 *
 * Sessions are looked up *by* hash, so the database index already does the comparison and this
 * is not on that path. It is here for the places that compare a value they were handed with one
 * they already hold — the node's service token, for instance.
 */
export function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** Pull a bearer token out of an Authorization header. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}
