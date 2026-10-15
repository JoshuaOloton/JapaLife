import { createPrismaClient, type PrismaClient } from "@japalife/db";

/**
 * Money tests truncate tables, so they must never run against the dev database.
 * They use "<name>_test", derived from DATABASE_URL, and refuse anything else.
 */

function loadRootEnv(): void {
  try {
    process.loadEnvFile(new URL("../../../../.env", import.meta.url));
  } catch {
    // No .env file: rely on the real environment.
  }
}

export interface TestDatabase {
  url: string;
  name: string;
  /** Same server, the maintenance database, for CREATE DATABASE. */
  adminUrl: string;
}

export function testDatabase(): TestDatabase {
  loadRootEnv();
  const base = process.env["DATABASE_URL"];
  if (!base) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env (see .env.example) and run `docker compose up -d postgres`.",
    );
  }
  const url = new URL(base);
  const devName = url.pathname.replace(/^\//, "");
  if (!devName) throw new Error("DATABASE_URL has no database name");

  const name = devName.endsWith("_test") ? devName : `${devName}_test`;
  const adminUrl = new URL(base);
  adminUrl.pathname = "/postgres";
  url.pathname = `/${name}`;

  if (!name.endsWith("_test")) {
    throw new Error("refusing to run money tests against a non-test database");
  }
  return { url: url.toString(), name, adminUrl: adminUrl.toString() };
}

export function createTestClient(maxConnections = 20): PrismaClient {
  return createPrismaClient(testDatabase().url, { maxConnections });
}

/** Empties every ledger table. TRUNCATE is not blocked by the append-only trigger. */
export async function resetLedgerTables(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Transaction", "Conversion", "Wallet", "Player" RESTART IDENTITY CASCADE',
  );
}
