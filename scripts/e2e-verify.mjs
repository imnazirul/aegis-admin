/**
 * Email verification, end to end, against a running dev server.
 *
 *   npm run dev
 *   node scripts/e2e-verify.mjs
 *
 * Sends real email to the SMTP account configured in .env.local, so it uses that address as the
 * recipient rather than someone else's.
 *
 * The codes are minted here rather than read out of the inbox — a six-digit code is stored only
 * as a hash, so the only way to exercise the endpoint is to plant one the same way the server
 * would. What is being tested is the checking, the attempt cap and the expiry, all of which are
 * server side.
 */

import { createHash, randomBytes } from "node:crypto";

import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL);

const stamp = Date.now();
// Gmail delivers anything with a plus tag to the same inbox, so this is a real, reachable
// address that does not collide with previous runs.
const inbox = process.env.SMTP_USER ?? "nobody@example.test";
const [name, domain] = inbox.split("@");
const email = `${name}+e2e${stamp}@${domain}`;
const password = "correct horse battery staple";
const nodeId = `e2e-verify-${stamp}`;
const deviceKey = "ef".repeat(32);

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail !== undefined ? `\n        ${JSON.stringify(detail)}` : ""}`);
  }
}

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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

const nodeToken = randomBytes(32).toString("base64url");
await sql`insert into nodes (id, name, endpoint, public_key, token_hash)
          values (${nodeId}, 'e2e', '127.0.0.1:51820', ${"ff".repeat(32)},
                  ${createHash("sha256").update(nodeToken).digest("hex")})`;

console.log("\nregistration sends a code\n");
const registered = await call("POST", "/api/auth/register", {
  body: { email, password, timezone: "Asia/Dhaka" },
});
check("creates the account", registered.status === 201, registered.body);
check("and says the address is not confirmed", registered.body?.emailVerified === false, registered.body);
const token = registered.body?.token;

const rows = await sql`select id from users where email = ${email}`;
const userId = rows[0]?.id;
const pending = await sql`select token_hash, email, expires_at, used_at, attempts
                          from email_verifications where user_id = ${userId}`;
check("a code was issued", pending.length === 1, pending.length);
check("stored only as a hash", /^[0-9a-f]{64}$/.test(pending[0]?.token_hash ?? ""), pending[0]?.token_hash);
check("and not yet used", pending[0]?.used_at === null, pending[0]?.used_at);
check("with no attempts spent", pending[0]?.attempts === 0, pending[0]?.attempts);
// Short-lived, because six digits is a million guesses rather than 2^256.
const ttl = (new Date(pending[0].expires_at).getTime() - Date.now()) / 60000;
check("good for about fifteen minutes, not a day", ttl > 10 && ttl < 20, ttl);

console.log("\nan unverified account cannot carry traffic\n");
await call("POST", "/api/auth/devices", { token, body: { publicKey: deviceKey, name: "e2e" } });
const refused = await fetch(`${BASE}/api/node/authorize`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${nodeToken}` },
  body: JSON.stringify({ publicKey: deviceKey }),
}).then((r) => r.json());
check("the node refuses it", refused.allowed === false, refused);
check("and says why", refused.reason === "email_unverified", refused);
check("in words the user can act on", /Confirm your email/i.test(refused.message ?? ""), refused.message);

console.log("\nthe code\n");
const anon = await call("POST", "/api/auth/verify", { body: { code: "123456" } });
check("submitting a code without a session is refused", anon.status === 401, anon);

// Mint a code the way the server does, so the endpoint under test is the one the app calls.
const hashOf = (v) => createHash("sha256").update(v).digest("hex");
async function issue(code, { minutes = 15 } = {}) {
  await sql`update email_verifications set used_at = now() where user_id = ${userId}`;
  await sql`insert into email_verifications (user_id, email, token_hash, expires_at)
            values (${userId}, ${email}, ${hashOf(code)},
                    now() + make_interval(mins => ${minutes}))`;
}

await issue("314159");

const wrong = await call("POST", "/api/auth/verify", { token, body: { code: "000000" } });
check("a wrong code is refused", wrong.status >= 400, wrong);
check("and counts down the attempts left", /4 attempts left/.test(wrong.body?.message ?? ""), wrong.body);
const spent = await sql`select attempts from email_verifications
                        where user_id = ${userId} and used_at is null`;
check("the attempt is recorded in the database, not in memory", spent[0]?.attempts === 1, spent[0]);

const stillOut = await sql`select email_verified_at from users where id = ${userId}`;
check("a wrong code verifies nothing", stillOut[0]?.email_verified_at === null, stillOut[0]);

console.log("\nguessing is capped\n");
await issue("271828");
for (let i = 0; i < 4; i += 1) {
  await call("POST", "/api/auth/verify", { token, body: { code: "111111" } });
}
const fifth = await call("POST", "/api/auth/verify", { token, body: { code: "111111" } });
check("the fifth wrong guess burns the code", /no longer valid/i.test(fifth.body?.message ?? ""), fifth.body);
const burned = await call("POST", "/api/auth/verify", { token, body: { code: "271828" } });
check("and the right code no longer works after that", burned.status >= 400, burned.body);

console.log("\nexpiry\n");
await issue("161803", { minutes: -1 });
const stale = await call("POST", "/api/auth/verify", { token, body: { code: "161803" } });
check("an expired code is refused as expired", /expired/i.test(stale.body?.message ?? ""), stale.body);

console.log("\nthe right code\n");
await issue("141592");
const spaced = await call("POST", "/api/auth/verify", { token, body: { code: "141 592" } });
check("a code pasted with a space is accepted", spaced.status === 200, spaced.body);
check("and reports it as newly verified", spaced.body?.already === false, spaced.body);

const after = await sql`select email_verified_at from users where id = ${userId}`;
check("the account is marked verified", after[0]?.email_verified_at !== null, after[0]);
const closed = await sql`select used_at from email_verifications
                         where user_id = ${userId} and token_hash = ${hashOf("141592")}`;
check("the code is spent", closed[0]?.used_at !== null, closed[0]);

const twice = await call("POST", "/api/auth/verify", { token, body: { code: "141592" } });
check("submitting twice says already confirmed, not an error", twice.body?.already === true, twice.body);

console.log("\nand now it may connect\n");
const allowed = await fetch(`${BASE}/api/node/authorize`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${nodeToken}` },
  body: JSON.stringify({ publicKey: deviceKey }),
}).then((r) => r.json());
check("the node allows it", allowed.allowed === true, allowed);

console.log("\nresending\n");
const resend = await call("POST", "/api/auth/resend", { token });
check("resending a verified account is a no-op, not an error", resend.body?.alreadyVerified === true, resend.body);

await sql`delete from users where email = ${email}`;
await sql`delete from nodes where id = ${nodeId}`;
console.log(`\ncleaned up (a real email went to ${email})`);

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
