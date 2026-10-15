import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/test/globalSetup.ts"],
    // Ledger tests share one test database and truncate it, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
