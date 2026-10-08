import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Only DATABASE_URL_TEST is exposed to tests: the production DATABASE_URL never reaches them.
const { DATABASE_URL_TEST } = loadEnv("test", process.cwd(), "");
if (DATABASE_URL_TEST) process.env.DATABASE_URL_TEST ??= DATABASE_URL_TEST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup-db.ts"],
    // All files share one database: running them in parallel would let one file's
    // TRUNCATE wipe rows another file is still using.
    fileParallelism: false,
  },
});
