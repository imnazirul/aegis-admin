/**
 * Register a VPN node and print its service token.
 *
 *   node scripts/create-node.mjs vps-1 "Frankfurt" 156.67.214.42:51820 <node-public-key-hex>
 *
 * The token is shown **once** and stored only as a hash. If it is lost, run this again for the
 * same id — it replaces the token rather than failing, which is the recovery path.
 *
 * Like admins, there is no HTTP endpoint that does this. Anything reachable over the network
 * that can mint a credential able to speak for every user's traffic is a door that only needs
 * to be wrong once.
 */

import { randomBytes, createHash } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const [id, name, endpoint, publicKey] = process.argv.slice(2);

if (!id || !name || !endpoint || !publicKey) {
  console.error("usage: node scripts/create-node.mjs <id> <name> <host:port> <public-key-hex>");
  process.exit(2);
}
if (!/^[0-9a-f]{64}$/.test(publicKey)) {
  console.error("the public key must be 64 lowercase hex characters (32 bytes)");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set; expected it in .env.local");
  process.exit(2);
}

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");

const sql = neon(process.env.DATABASE_URL);
await sql`
  insert into nodes (id, name, endpoint, public_key, token_hash)
  values (${id}, ${name}, ${endpoint}, ${publicKey}, ${tokenHash})
  on conflict (id) do update set
    name = excluded.name,
    endpoint = excluded.endpoint,
    public_key = excluded.public_key,
    token_hash = excluded.token_hash
`;

console.log(`node ${id} registered.\n`);
console.log("Put this in the node's environment. It is not stored and cannot be shown again:\n");
console.log(`  AEGIS_CONTROL_TOKEN=${token}\n`);
