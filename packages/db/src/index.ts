import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

export * from "./generated/client";

/**
 * Prisma 7 has no built-in engine: it talks to Postgres through a driver
 * adapter. `maxConnections` bounds the pool so a burst of concurrent money
 * operations queues instead of exhausting the database.
 */
export function createPrismaClient(
  connectionString: string,
  options: { maxConnections?: number } = {},
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    max: options.maxConnections ?? 10,
  });
  return new PrismaClient({ adapter });
}
