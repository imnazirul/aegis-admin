/**
 * Who can sign in to the admin panel.
 *
 * Passwords are Argon2 hashes and cannot be read back — this only lists who exists. To change
 * one, run create-admin.mjs again with the same email.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`select email, name, last_login_at, created_at from admins order by created_at`;
if (rows.length === 0) {
  console.log("No admins exist. Create one:\n  npm run admin:create you@example.com \"a passphrase\"");
} else {
  for (const r of rows) {
    console.log(`${r.email}${r.name ? ` (${r.name})` : ""}`);
    console.log(`  created    ${r.created_at.toISOString()}`);
    console.log(`  last login ${r.last_login_at ? r.last_login_at.toISOString() : "never"}`);
  }
}
