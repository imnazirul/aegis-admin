/**
 * Exercise the auth API against a running dev server and the real database.
 *
 *   npm run dev          # in one terminal
 *   node scripts/e2e-auth.mjs
 *
 * Cleans up the account it creates, so it is safe to run repeatedly.
 */

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const email = `e2e-${Date.now()}@example.test`;
const password = "correct horse battery staple";

let failures = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? `\n        ${JSON.stringify(detail)}` : ""}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: json };
}

const keyA = "a".repeat(64);
const keyB = "b".repeat(64);

console.log(`\nregistration\n`);
const registered = await call("POST", "/api/auth/register", {
  body: { email, password, timezone: "Asia/Dhaka" },
});
check("creates an account", registered.status === 201, registered.body);
check("returns a token", typeof registered.body?.token === "string", registered.body);
check("keeps the timezone", registered.body?.user?.timezone === "Asia/Dhaka", registered.body);

const dup = await call("POST", "/api/auth/register", { body: { email, password } });
check("refuses a duplicate email", dup.body?.error === "email_taken", dup.body);

const short = await call("POST", "/api/auth/register", {
  body: { email: `x${email}`, password: "short" },
});
check("refuses a short password", short.body?.error === "invalid_request", short.body);

console.log(`\nsign in\n`);
const wrong = await call("POST", "/api/auth/login", { body: { email, password: "not it" } });
check("rejects a wrong password", wrong.body?.error === "invalid_credentials", wrong.body);

const unknown = await call("POST", "/api/auth/login", {
  body: { email: "nobody@example.test", password },
});
check(
  "says the same thing for an unknown email",
  unknown.body?.error === "invalid_credentials" && unknown.body?.message === wrong.body?.message,
  { unknown: unknown.body, wrong: wrong.body },
);

const login = await call("POST", "/api/auth/login", { body: { email, password } });
check("accepts the right password", login.status === 200, login.body);
const token = login.body?.token;

console.log(`\nsession\n`);
const anon = await call("GET", "/api/auth/me");
check("refuses an unauthenticated request", anon.body?.error === "unauthorized", anon.body);

const bad = await call("GET", "/api/auth/me", { token: "not-a-real-token" });
check("refuses a forged token", bad.body?.error === "unauthorized", bad.body);

const me = await call("GET", "/api/auth/me", { token });
check("returns the account", me.body?.user?.email === email, me.body);
check("starts at zero usage", me.body?.usage?.daily?.bytes === 0, me.body?.usage);
check("reports unlimited by default", me.body?.usage?.monthly?.limitBytes === null, me.body?.usage);
check("has no devices yet", me.body?.devices?.length === 0, me.body?.devices);
check(
  "resets at the user's own midnight, not the server's",
  // Dhaka is UTC+6, so midnight there is 18:00 UTC.
  new Date(me.body?.usage?.daily?.resetsAt).getUTCHours() === 18,
  me.body?.usage?.daily,
);

console.log(`\ndevices\n`);
const enrol = await call("POST", "/api/auth/devices", { token, body: { publicKey: keyA, name: "PC" } });
check("enrols the first device", enrol.status === 201, enrol.body);

const second = await call("POST", "/api/auth/devices", { token, body: { publicKey: keyB } });
check("refuses a second, at a limit of one", second.body?.error === "device_limit_reached", second.body);

const again = await call("POST", "/api/auth/devices", { token, body: { publicKey: keyA } });
check("re-enrolling the same device is not an error", again.status === 200, again.body);

const badKey = await call("POST", "/api/auth/devices", { token, body: { publicKey: "nope" } });
check("rejects a malformed key", badKey.body?.error === "invalid_request", badKey.body);

const deviceId = enrol.body?.device?.id;
const removed = await call("DELETE", `/api/auth/devices/${deviceId}`, { token });
check("revokes a device", removed.status === 200, removed.body);

const afterRemoval = await call("POST", "/api/auth/devices", { token, body: { publicKey: keyB } });
check("frees the slot", afterRemoval.status === 201, afterRemoval.body);

console.log(`\nsign out\n`);
const out = await call("POST", "/api/auth/logout", { token });
check("logs out", out.status === 204, out.body);

const afterLogout = await call("GET", "/api/auth/me", { token });
check("the token stops working", afterLogout.body?.error === "unauthorized", afterLogout.body);

// ── clean up ────────────────────────────────────────────────────────────────────────────────
const sql = neon(process.env.DATABASE_URL);
await sql`delete from users where email = ${email}`;
await sql`delete from login_attempts where key like 'e2e-%' or key = 'unknown'`;
console.log(`\ncleaned up ${email}`);

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
