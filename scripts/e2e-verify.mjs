/**
 * Email verification, end to end, against a running dev server.
 *
 *   npm run dev
 *   node scripts/e2e-verify.mjs
 *
 * Sends real email to the SMTP account configured in .env.local, so it uses that address as the
 * recipient rather than someone else's.
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

console.log("\nregistration sends a link\n");
const registered = await call("POST", "/api/auth/register", {
  body: { email, password, timezone: "Asia/Dhaka" },
});
check("creates the account", registered.status === 201, registered.body);
check("and says the address is not confirmed", registered.body?.emailVerified === false, registered.body);
const token = registered.body?.token;

const rows = await sql`select id from users where email = ${email}`;
const userId = rows[0]?.id;
const pending = await sql`select token_hash, email, expires_at, used_at
                          from email_verifications where user_id = ${userId}`;
check("a verification was issued", pending.length === 1, pending.length);
check("stored only as a hash", /^[0-9a-f]{64}$/.test(pending[0]?.token_hash ?? ""), pending[0]?.token_hash);
check("and not yet used", pending[0]?.used_at === null, pending[0]?.used_at);

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

console.log("\nthe link\n");
const bad = await fetch(`${BASE}/verify?token=not-a-real-token`).then((r) => r.text());
check("a bogus token is refused", /not valid/i.test(bad), "page did not say it was invalid");

// Exercise the real path by minting a token the same way the server does, so the page under
// test is the one users open.
const raw = randomBytes(32).toString("base64url");
await sql`update email_verifications set used_at = now() where user_id = ${userId}`;
await sql`insert into email_verifications (user_id, email, token_hash, expires_at)
          values (${userId}, ${email}, ${createHash("sha256").update(raw).digest("hex")},
                  now() + interval '24 hours')`;

const good = await fetch(`${BASE}/verify?token=${encodeURIComponent(raw)}`).then((r) => r.text());
check("a valid token confirms the address", /Email confirmed/i.test(good), "page did not confirm");

const after = await sql`select email_verified_at from users where id = ${userId}`;
check("the account is marked verified", after[0]?.email_verified_at !== null, after[0]);

const again = await fetch(`${BASE}/verify?token=${encodeURIComponent(raw)}`).then((r) => r.text());
check("clicking twice says already confirmed, not an error", /Already confirmed/i.test(again), "second click errored");

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
