/**
 * Check that the panel's pages actually render, with real data, behind the auth guard.
 *
 *   npm run dev
 *   node scripts/e2e-pages.mjs
 *
 * A build succeeding proves the code compiles. It does not prove a page renders — a server
 * component that throws produces a 500 at request time, long after the build was green.
 */

import { config } from "dotenv";
import { hash } from "@node-rs/argon2";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL);

const stamp = Date.now();
const adminEmail = `e2e-pages-${stamp}@example.test`;
const adminPassword = "an admin passphrase";
const userEmail = `e2e-shown-${stamp}@example.test`;

let failures = 0;
let cookie = "";

function check(name, condition, detail) {
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail !== undefined ? `\n        ${String(detail).slice(0, 300)}` : ""}`);
  }
}

async function page(path, { redirect = "manual" } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect,
    headers: cookie ? { cookie } : {},
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const raw = await res.text();
  return {
    status: res.status,
    location: res.headers.get("location"),
    raw,
    // React puts `<!-- -->` between adjacent text nodes during server rendering, so `{a}/{b}`
    // arrives as `0<!-- -->/<!-- -->2`. Stripping comments lets an assertion look for what a
    // person would see rather than for React's plumbing.
    html: raw.replace(/<!--.*?-->/g, ""),
  };
}

const PARAMS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 };

await sql`insert into admins (email, password_hash, name)
          values (${adminEmail}, ${await hash(adminPassword, PARAMS)}, 'e2e')`;

// A user with real usage, so the dashboard and detail pages have something to draw.
const GB = 1024 ** 3;
const [user] = await sql`
  insert into users (email, password_hash, timezone, monthly_limit_bytes, device_limit)
  values (${userEmail}, ${await hash("correct horse battery staple", PARAMS)}, 'Asia/Dhaka', ${10 * GB}, 2)
  returning id`;

// Nine gigabytes against a ten gigabyte limit: enough to land in "approaching their limit".
await sql`insert into usage_daily (user_id, local_day, bytes_up, bytes_down)
          values (${user.id}, (now() at time zone 'Asia/Dhaka')::date, ${4 * GB}, ${5 * GB})`;

console.log("\nthe guard\n");
const anon = await page("/");
check("an unauthenticated visitor is redirected", anon.status === 307 || anon.status === 302, anon.status);
check("...to the login page", (anon.location ?? "").includes("/login"), anon.location);

const loginPage = await page("/login");
check("the login page renders", loginPage.status === 200 && loginPage.html.includes("Aegis Admin"), loginPage.status);
check(
  "and says how admins are created, since there is no sign-up",
  loginPage.html.includes("create-admin"),
  "missing the explanation",
);

const res = await fetch(`${BASE}/api/admin/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: adminPassword }),
});
cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
check("signing in sets a cookie", cookie.length > 0, cookie);

console.log("\ndashboard\n");
const dash = await page("/");
check("renders", dash.status === 200, dash.status);
check("shows the monthly total", dash.html.includes("Bandwidth this month"), "heading missing");
check("shows the trend chart", dash.html.includes("Bandwidth per day"), "chart missing");
check("shows the 9 GB of usage", dash.html.includes("9.0 GB"), "usage not rendered");
check(
  "lists the user as approaching their limit",
  dash.html.includes("Approaching their limit") && dash.html.includes(userEmail),
  "near-limit panel did not include them",
);
check(
  "labels status in words, not colour alone",
  dash.html.includes(">near<") || dash.html.includes(">over<"),
  "no textual status label found",
);
check("states how totals are computed", dash.html.includes("sum of each user"), "note missing");

console.log("\nuser list\n");
const list = await page("/users");
check("renders", list.status === 200, list.status);
check("includes the user", list.html.includes(userEmail), "user missing");
check("shows their device allowance", list.html.includes("0/2"), "device count missing");
check("shows the monthly limit", list.html.includes("10.0 GB"), "limit missing");

const search = await page(`/users?q=${encodeURIComponent("nobody-matches-this")}`);
check("an empty search says so", search.html.includes("Nobody matches"), "empty state missing");

console.log("\nuser detail\n");
const detail = await page(`/users/${user.id}`);
check("renders", detail.status === 200, detail.status);
check("shows the email", detail.html.includes(userEmail), "email missing");
check("shows all three periods", ["Today", "This week", "This month"].every((s) => detail.html.includes(s)), "periods missing");
check("shows the limits form", detail.html.includes("Leave a box empty for unlimited"), "controls missing");
check("offers to block", detail.html.includes("Block"), "block control missing");
check(
  "says devices are not enrolled yet, rather than showing an empty box",
  detail.html.includes("No devices enrolled"),
  "empty state missing",
);
check("never leaks the password hash", !detail.raw.includes("$argon2id$"), "HASH LEAKED INTO THE PAGE");

const missing = await page("/users/00000000-0000-0000-0000-000000000000");
check("an unknown user is a 404, not a crash", missing.status === 404, missing.status);

await sql`delete from users where email = ${userEmail}`;
await sql`delete from admins where email = ${adminEmail}`;
console.log("\ncleaned up");

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
