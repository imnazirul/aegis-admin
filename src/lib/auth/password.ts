/**
 * Password hashing.
 *
 * Argon2id with OWASP's current parameters: 19 MiB of memory, two passes, one lane. The memory
 * cost is the point — it is what makes a GPU array no better at guessing than a CPU, and it is
 * the parameter people quietly lower when logins feel slow. Do not.
 *
 * `@node-rs/argon2` is a native binding with prebuilt binaries, so it works on Vercel without a
 * build step. A pure-JS implementation would be slow enough that the *server* becomes the thing
 * that is easy to overwhelm.
 */

import { hash, verify, type Algorithm } from "@node-rs/argon2";

/**
 * `Algorithm.Argon2id`, written as its value.
 *
 * The enum is an ambient `const enum`, which `isolatedModules` — on by default in Next —
 * forbids reading at runtime. The type still imports, so this stays checked: change the
 * numeral to something that is not a valid `Algorithm` and it fails to compile.
 *
 * Stated explicitly rather than left to the library's default. Argon2id is what protects
 * against both GPU and side-channel attacks, and it should not silently become something else
 * because a dependency changed its mind.
 */
const ARGON2ID = 2 as Algorithm;

const PARAMS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A hash long enough to be a real password and short enough not to be a denial of service.
 *
 * Argon2 hashes the input before the expensive part, so a megabyte password is not slow to
 * hash — but it is a megabyte of request body accepted before we know who is asking.
 */
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 200;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS);
}

/**
 * Whether `plain` matches `stored`.
 *
 * A malformed stored hash is `false`, not a throw: one corrupt row should fail that user's
 * login, not return a 500 that tells an attacker something interesting about them.
 */
export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain, PARAMS);
  } catch {
    return false;
  }
}

/**
 * A hash of nothing anyone can log in with, used to spend the same time on an unknown email as
 * on a known one.
 *
 * Without it, "no such user" returns in a millisecond and "wrong password" in fifty, and the
 * difference is a reliable way to enumerate who has an account here. Computed once at startup
 * rather than per request.
 */
let decoy: Promise<string> | null = null;

export async function burnTimeLikeAVerify(): Promise<void> {
  decoy ??= hashPassword("this password belongs to nobody");
  await verifyPassword(await decoy, "not it");
}
