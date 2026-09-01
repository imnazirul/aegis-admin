/**
 * Exercise the admin API against a running dev server and the real database.
 *
 *   npm run dev
 *   node scripts/e2e-admin.mjs
 *
 * Creates a throwaway user and admin, and removes both afterwards.
 */

import { config } from "dotenv";
import { hash } from "@node-rs/argon2";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL);

const stamp = Date.now();
const adminEmail = `e2e-admin-${stamp}@example.test`;
const adminPassword = "an admin passphrase";
const userEmail = `e2e-user-${stamp}@example.test`;
const userPassword = "correct horse battery staple";

let failures = 0;
let cookie = "";

function check(name, condition, detail) {
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail !== undefined ? `\n        ${JSON.stringify(detail)}` : ""}`);
  }
}

async function call(method, path, { body, withCookie = true, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(withCookie && cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: json };
}

// A throwaway admin, created the same way the real one is.
await sql`
  insert into admins (email, password_hash, name) values (
    ${adminEmail},
    ${await hash(adminPassword, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 })},
    'e2e'
  )`;

console.log("\nadmin sign in\n");
const anon = await call("GET", "/api/admin/stats");
check("refuses an unauthenticated admin request", anon.body?.error === "unauthorized", anon.body);

const wrong = await call("POST", "/api/admin/login", {
  body: { email: adminEmail, password: "nope" },
});
check("rejects a wrong admin password", wrong.body?.error === "invalid_credentials", wrong.body);

const login = await call("POST", "/api/admin/login", {
  body: { email: adminEmail, password: adminPassword },
});
check("signs in and sets a cookie", login.status === 200 && cookie.length > 0, login.body);

const me = await call("GET", "/api/admin/me");
check("the cookie authenticates", me.body?.admin?.email === adminEmail, me.body);

console.log("\na user's account is not an admin account\n");
const registered = await call("POST", "/api/auth/register", {
  body: { email: userEmail, password: userPassword, timezone: "Asia/Dhaka" },
  withCookie: false,
});
check("creates the test user", registered.status === 201, registered.body);
const userToken = registered.body?.token;

const crossover = await call("GET", "/api/admin/stats", { withCookie: false, token: userToken });
check(
  "a user's bearer token cannot reach the admin API",
  crossover.body?.error === "unauthorized",
  crossover.body,
);

console.log("\nthe user list\n");
const list = await call("GET", `/api/admin/users?q=${encodeURIComponent(userEmail)}`);
check("finds the user by email", list.body?.users?.[0]?.email === userEmail, list.body);
const found = list.body?.users?.[0];
check("shows their timezone", found?.timezone === "Asia/Dhaka", found);
check("shows unlimited by default", found?.monthlyLimitBytes === null, found);
check("counts their devices", found?.devices === 0, found);
check("reports usage as a number, not a string", typeof found?.monthBytes === "number", found);

const userId = found?.id;

console.log("\nlimits\n");
const GB = 1024 ** 3;
const limited = await call("PATCH", `/api/admin/users/${userId}`, {
  body: { dailyLimitBytes: 5 * GB, monthlyLimitBytes: 100 * GB, deviceLimit: 3 },
});
check("sets limits", limited.body?.user?.dailyLimitBytes === 5 * GB, limited.body?.user);
check("raises the device limit", limited.body?.user?.deviceLimit === 3, limited.body?.user);

const detail = await call("GET", `/api/admin/users/${userId}`);
check("the detail view agrees", detail.body?.usage?.daily?.limitBytes === 5 * GB, detail.body?.usage);
check("never returns the password hash", detail.body?.user?.passwordHash === undefined, Object.keys(detail.body?.user ?? {}));
check(
  "resets at the user's midnight, not the server's",
  new Date(detail.body?.usage?.daily?.resetsAt).getUTCHours() === 18,
  detail.body?.usage?.daily,
);

const unlimited = await call("PATCH", `/api/admin/users/${userId}`, {
  body: { dailyLimitBytes: null },
});
check("null clears a limit back to unlimited", unlimited.body?.user?.dailyLimitBytes === null, unlimited.body?.user);

const badZone = await call("PATCH", `/api/admin/users/${userId}`, {
  body: { timezone: "Mars/Olympus_Mons" },
});
check("refuses an unknown timezone", badZone.body?.error === "invalid_request", badZone.body);

console.log("\nblocking\n");
const stillWorks = await call("GET", "/api/auth/me", { withCookie: false, token: userToken });
check("the user's session works before blocking", stillWorks.status === 200, stillWorks.body);

const blocked = await call("PATCH", `/api/admin/users/${userId}`, {
  body: { blocked: true, blockedReason: "abuse" },
});
check("blocks them", blocked.body?.user?.blocked === true, blocked.body?.user);
check("records the reason", blocked.body?.user?.blockedReason === "abuse", blocked.body?.user);

const afterBlock = await call("GET", "/api/auth/me", { withCookie: false, token: userToken });
check(
  "blocking ends their sessions rather than waiting for expiry",
  afterBlock.body?.error === "unauthorized",
  afterBlock.body,
);

const unblocked = await call("PATCH", `/api/admin/users/${userId}`, { body: { blocked: false } });
check("unblocks them", unblocked.body?.user?.blocked === false, unblocked.body?.user);
check("clears the reason too", unblocked.body?.user?.blockedReason === null, unblocked.body?.user);

const audit = await sql`select action from audit_log where target_user_id = ${userId} order by at`;
check(
  "every change is in the audit log",
  // Three PATCHes succeeded and one was rejected for a bad timezone; a rejected change must
  // not appear in the log.
  audit.map((a) => a.action).join(",") === "user.update,user.update,user.block,user.unblock",
  audit.map((a) => a.action),
);

console.log("\ndashboard\n");
const stats = await call("GET", "/api/admin/stats");
check("returns totals", typeof stats.body?.totals?.thisMonth === "number", stats.body?.totals);
check("counts users", stats.body?.counts?.users >= 1, stats.body?.counts);
check("returns a trend series", Array.isArray(stats.body?.trend), stats.body?.trend);
check("returns top users", Array.isArray(stats.body?.topUsers), stats.body?.topUsers);
check("labels how totals are computed", typeof stats.body?.note === "string", stats.body?.note);

console.log("\nsign out\n");
const out = await call("POST", "/api/admin/logout");
check("logs out", out.status === 204, out.body);
const afterLogout = await call("GET", "/api/admin/me");
check("the admin cookie stops working", afterLogout.body?.error === "unauthorized", afterLogout.body);

await sql`delete from users where email = ${userEmail}`;
await sql`delete from admins where email = ${adminEmail}`;
await sql`delete from login_attempts where key like 'e2e-%'`;
console.log("\ncleaned up");

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
