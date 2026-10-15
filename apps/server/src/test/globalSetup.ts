import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "@japalife/db";
import { testDatabase } from "./testDb";

/** Creates the test database if needed and brings it up to the latest migration. */
export default async function setup(): Promise<void> {
  const db = testDatabase();

  const admin = createPrismaClient(db.adminUrl, { maxConnections: 1 });
  try {
    const found = await admin.$queryRaw<
      { exists: number }[]
    >`SELECT 1 AS "exists" FROM pg_database WHERE datname = ${db.name}`;
    if (found.length === 0) {
      // Identifiers cannot be bound as parameters; the name is validated to end in _test.
      if (!/^[A-Za-z0-9_]+$/.test(db.name)) throw new Error("unsafe test database name");
      await admin.$executeRawUnsafe(`CREATE DATABASE "${db.name}"`);
    }
  } catch (error) {
    throw new Error(
      "Cannot reach Postgres to prepare the test database. Is it running? " +
        "Try: docker compose up -d postgres",
      { cause: error },
    );
  } finally {
    await admin.$disconnect();
  }

  const dbPackage = fileURLToPath(new URL("../../../../packages/db", import.meta.url));
  execFileSync(`${dbPackage}/node_modules/.bin/prisma`, ["migrate", "deploy"], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: db.url },
    stdio: "pipe",
  });
}
