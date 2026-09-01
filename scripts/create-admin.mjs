/**
 * Create the first admin, or add another.
 *
 *   node scripts/create-admin.mjs you@example.com "a long passphrase" "Your Name"
 *
 * There is deliberately no self-service admin registration and no HTTP endpoint that creates
 * one. Anything reachable over the network that can mint an account able to unblock users and
 * lift bandwidth limits is a door that only ever needs to be wrong once. Running a command on a
 * machine that already holds the database credentials adds no new authority to anybody.
 *
 * Re-running it for an existing email resets that admin's password, which is also the recovery
 * path when one is forgotten.
 */

import { hash } from "@node-rs/argon2";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const [email, password, name = ""] = process.argv.slice(2);

if (!email || !password) {
  console.error('usage: node scripts/create-admin.mjs <email> <password> [name]');
  process.exit(2);
}
if (password.length < 12) {
  // Longer than the 10 required of users. This account can change everyone else's.
  console.error("an admin password must be at least 12 characters");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set; expected it in .env.local");
  process.exit(2);
}

// Must match src/lib/auth/password.ts. Argon2 records its parameters inside the hash, so a
// mismatch here would still verify — but it would leave one account weaker than the rest.
const PARAMS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

const sql = neon(process.env.DATABASE_URL);
const normalised = email.trim().toLowerCase();
const passwordHash = await hash(password, PARAMS);

const [row] = await sql`
  insert into admins (email, password_hash, name)
  values (${normalised}, ${passwordHash}, ${name})
  on conflict (email) do update set password_hash = excluded.password_hash
  returning id, email, name, created_at
`;

console.log(`admin ready: ${row.email}`);
console.log(`  id      ${row.id}`);
if (name) console.log(`  name    ${row.name}`);
console.log("\nSign in at /login");
