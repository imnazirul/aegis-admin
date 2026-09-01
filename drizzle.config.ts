/**
 * How `drizzle-kit` finds the schema and the database.
 *
 * `generate` writes plain .sql files into ./drizzle. They are meant to be read before they are
 * run: this database holds the accounts, and a migration that quietly drops a column is much
 * easier to catch in review than to undo afterwards.
 */
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js loads .env.local for the app; drizzle-kit is a separate process and does not.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // Ask before anything destructive, rather than discovering it in the diff afterwards.
  strict: true,
  verbose: true,
});
