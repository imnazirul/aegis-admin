import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Integration tests talk to the real database; unit tests ignore this entirely.
config({ path: ".env.local" });

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Usage tests share one database, so they must not race each other.
    fileParallelism: false,
  },
});
