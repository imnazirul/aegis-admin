import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);
const tables = await sql`select table_name from information_schema.tables where table_schema='public' order by 1`;
console.log("tables:", tables.map(t => t.table_name).join(", "));
const cols = await sql`select column_name, data_type from information_schema.columns where table_name='usage_daily' order by ordinal_position`;
console.log("\nusage_daily:");
for (const c of cols) console.log(`  ${c.column_name.padEnd(12)} ${c.data_type}`);
const pk = await sql`
  select a.attname from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = 'usage_daily'::regclass and i.indisprimary`;
console.log("primary key:", pk.map(r => r.attname).join(" + "));
const v = await sql`select version()`;
console.log("\n" + v[0].version.split(",")[0]);
