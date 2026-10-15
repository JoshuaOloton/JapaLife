import { createPrismaClient } from "@japalife/db";
import { Ledger } from "./economy/ledger";
import { SEED_TEST_PLAYER_BALANCE, seedTestPlayer } from "./economy/seedTestPlayer";
import { WalletService } from "./economy/wallet";
import { loadRootEnv } from "./env";

loadRootEnv();

if (process.env["NODE_ENV"] === "production") {
  throw new Error("refusing to seed test data in production");
}
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

const db = createPrismaClient(databaseUrl, { maxConnections: 2 });
try {
  const wallet = new WalletService(new Ledger(db));
  const playerId = await seedTestPlayer(db, wallet);
  const balance = await wallet.getBalance(playerId, "NGN");
  console.log(
    `seeded ${playerId}: ${balance} kobo (expected ${SEED_TEST_PLAYER_BALANCE}, i.e. N${balance / 100n})`,
  );
} finally {
  await db.$disconnect();
}
