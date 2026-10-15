import { defineConfig } from "prisma/config";

// Prisma 7 does not read .env itself. Load the repo-root file if it exists.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // No .env: rely on the real environment (CI, production).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // generate and validate do not connect, so a missing URL must not break them.
    url: process.env["DATABASE_URL"] ?? "postgresql://unset:unset@localhost:5432/unset",
  },
});
