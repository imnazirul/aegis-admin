/**
 * Exercise the node API — authorization, usage reporting and enforcement.
 *
 *   npm run dev
 *   node scripts/e2e-node.mjs
 *
 * This is the path that decides whether somebody's tunnel lives or dies, so it is checked
 * against the real database rather than mocked.
 */

import { createHash, randomBytes } from "node:crypto";

import { config } from "dotenv";
import { hash } from "@node-rs/argon2";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL);

const stamp = Date.now();
const nodeId = `e2e-node-${stamp}`;
const userEmail = `e2e-node-user-${stamp}@example.test`;
const keyA = "a1".repeat(32);
const keyB = "b2".repeat(32);
const keyUnknown = "cc".repeat(32);

let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail !== undefined ? `\n        ${JSON.stringify(detail)}` : ""}`);
  }
}

const token = randomBytes(32).toString("base64url");

async function call(path, body, useToken = token) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(useToken ? { authorization: `Bearer ${useToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json };
}

const authorize = (publicKey) => call("/api/node/authorize", { publicKey });
const report = (reports, at) => call("/api/node/usage", { reports, ...(at ? { at } : {}) });

// ── set the stage ───────────────────────────────────────────────────────────────────────────
await sql`insert into nodes (id, name, endpoint, public_key, token_hash)
          values (${nodeId}, 'e2e', '127.0.0.1:51820', ${"ff".repeat(32)},
                  ${createHash("sha256").update(token).digest("hex")})`;

const [user] = await sql`
  insert into users (email, password_hash, timezone, device_limit)
  values (${userEmail}, ${await hash("correct horse battery staple", {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })}, 'Asia/Dhaka', 1)
  returning id`;

await sql`insert into devices (user_id, public_key, name) values (${user.id}, ${keyA}, 'first')`;
// Enrolled second, so it is the one the device limit excludes.
await sql`insert into devices (user_id, public_key, name) values (${user.id}, ${keyB}, 'second')`;

console.log("\nnode authentication\n");
const noToken = await call("/api/node/authorize", { publicKey: keyA }, null);
check("refuses a request with no node token", noToken.body?.error === "unauthorized", noToken.body);

const badToken = await call("/api/node/authorize", { publicKey: keyA }, "not-a-real-token");
check("refuses a forged node token", badToken.body?.error === "unauthorized", badToken.body);

console.log("\nauthorizing a device\n");
const allowed = await authorize(keyA);
check("allows an enrolled device on a healthy account", allowed.body?.allowed === true, allowed.body);
check("tells the node whose it is", allowed.body?.email === userEmail, allowed.body);
check("tells the node when to ask again", allowed.body?.recheckAfterSeconds > 0, allowed.body);
check("includes their current usage", allowed.body?.usage?.daily?.bytes === 0, allowed.body?.usage);

const unknown = await authorize(keyUnknown);
check("refuses a device nobody enrolled", unknown.body?.reason === "unknown_device", unknown.body);
check(
  "and a refusal is a 200, not an HTTP error",
  unknown.status === 200,
  "the node must be able to tell 'no' from 'your token is wrong'",
);

const overLimit = await authorize(keyB);
check(
  "refuses the second device when only one is allowed",
  overLimit.body?.reason === "device_limit",
  overLimit.body,
);
check("explains it in words a person can act on", /Remove another device/.test(overLimit.body?.message ?? ""), overLimit.body?.message);

console.log("\nreporting usage\n");
const first = await report([{ publicKey: keyA, bytesUp: 1_000, bytesDown: 2_000 }]);
check("accepts a report", first.status === 200, first.body);
check("returns a verdict per device", first.body?.verdicts?.length === 1, first.body);
check("and the verdict still allows them", first.body?.verdicts?.[0]?.allowed === true, first.body?.verdicts);

const stored = await sql`select bytes_up, bytes_down, local_day::text as day
                         from usage_daily where user_id = ${user.id}`;
check("the usage was stored", Number(stored[0]?.bytes_up) === 1_000, stored);
check(
  "bucketed by the user's local day, not the server's",
  stored[0]?.day === new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10),
  { stored: stored[0]?.day, expected: "Dhaka is UTC+6" },
);

const twice = await report([
  { publicKey: keyA, bytesUp: 10, bytesDown: 0 },
  { publicKey: keyA, bytesUp: 5, bytesDown: 0 },
]);
check("adds deltas rather than replacing", twice.status === 200, twice.body);
const after = await sql`select bytes_up from usage_daily where user_id = ${user.id}`;
check("two reports for one device in one batch are both counted", Number(after[0]?.bytes_up) === 1_015, after);

const ghost = await report([{ publicKey: keyUnknown, bytesUp: 999, bytesDown: 0 }]);
check(
  "usage for an unknown device is refused, not attributed to somebody",
  ghost.body?.verdicts?.[0]?.reason === "unknown_device",
  ghost.body,
);

console.log("\nenforcement\n");
await sql`update users set daily_limit_bytes = ${2000} where id = ${user.id}`;
const nowOver = await authorize(keyA);
check("refuses once the daily limit is reached", nowOver.body?.reason === "over_quota", nowOver.body);
check("says when it frees up", typeof nowOver.body?.retryAt === "string", nowOver.body);

const flushWhileOver = await report([{ publicKey: keyA, bytesUp: 1, bytesDown: 0 }]);
check(
  "a live session is told to stop on its next flush",
  flushWhileOver.body?.verdicts?.[0]?.allowed === false,
  flushWhileOver.body?.verdicts,
);

await sql`update users set daily_limit_bytes = null where id = ${user.id}`;
const unlimited = await authorize(keyA);
check("clearing the limit lets them back in", unlimited.body?.allowed === true, unlimited.body);

await sql`update users set blocked_at = now(), blocked_reason = 'abuse' where id = ${user.id}`;
const blocked = await authorize(keyA);
check("refuses a blocked account", blocked.body?.reason === "blocked", blocked.body);
check("passes the reason through", /abuse/.test(blocked.body?.message ?? ""), blocked.body?.message);
check("a block has no retry time, because waiting will not help", blocked.body?.retryAt === undefined, blocked.body);

await sql`update users set blocked_at = null, blocked_reason = null where id = ${user.id}`;

console.log("\nsessions\n");
const started = await call("/api/node/session", { publicKey: keyA, event: "start", assignedIp: "10.99.1.0" });
check("records a session start", typeof started.body?.sessionId === "string", started.body);

const open1 = await sql`select count(*)::int as n from tunnel_sessions
                        where user_id = ${user.id} and ended_at is null`;
check("the session is open", open1[0].n === 1, open1);

await call("/api/node/session", { publicKey: keyA, event: "start", assignedIp: "10.99.1.1" });
const open2 = await sql`select count(*)::int as n from tunnel_sessions
                        where user_id = ${user.id} and ended_at is null`;
check(
  "a second start closes the first, so a crashed node cannot leave sessions open forever",
  open2[0].n === 1,
  open2,
);

await call("/api/node/session", { publicKey: keyA, event: "end" });
const open3 = await sql`select count(*)::int as n from tunnel_sessions
                        where user_id = ${user.id} and ended_at is null`;
check("ending closes it", open3[0].n === 0, open3);

// ── clean up ────────────────────────────────────────────────────────────────────────────────
await sql`delete from users where id = ${user.id}`;
await sql`delete from nodes where id = ${nodeId}`;
console.log("\ncleaned up");

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
