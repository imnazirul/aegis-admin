/**
 * The database handle.
 *
 * Neon's own driver rather than `pg`, and that is not a preference. Classic TCP pooling and
 * serverless functions do not mix: every cold function opens its own pool, Neon caps
 * connections per project, and the whole thing falls over under exactly the load you want to
 * have. Neon's driver sends one-shot queries over HTTP, so there is no pool to exhaust.
 *
 * Transactions need a real connection and are not available over that transport. Nothing here
 * needs one yet — usage flushes are single-statement upserts — and when something does, it
 * moves to the WebSocket driver rather than dragging the whole application onto it.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

/**
 * Read at module load and fail loudly if absent.
 *
 * A missing connection string that surfaces as an empty user list halfway through a request is
 * far worse than one that stops the server starting.
 */
function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Put the Neon connection string in .env.local — it is " +
        "gitignored — and restart the dev server.",
    );
  }
  return url;
}

export const db = drizzle(neon(connectionString()), { schema });

export * from "./schema";
