import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@japalife/db";
import { formatNaira } from "@japalife/shared";
import { Ledger } from "./economy/ledger";
import { WalletService } from "./economy/wallet";
import { loadRootEnv } from "./env";

/**
 * Play-testing helper: gives a player naira through the ledger.
 * `pnpm grant-money <naira> <playerId>`. Logged as `family_help`, a real
 * faucet, so BalanceWatch flags it (its ceiling is zero): expected in dev.
 * The HUD shows the new balance after the player's next action or event check.
 */

loadRootEnv();

if (process.env["NODE_ENV"] === "production") {
  throw new Error("refusing to grant test money in production");
}
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. See .env.example.");
}

const [nairaArg, playerId] = process.argv.slice(2);
const naira = Number(nairaArg);
if (!Number.isSafeInteger(naira) || naira <= 0 || naira > 100_000_000 || !playerId) {
  console.error("usage: pnpm grant-money <whole naira, up to 100,000,000> <playerId>");
  process.exit(1);
}

const db = createPrismaClient(databaseUrl, { maxConnections: 2 });
try {
  if (!(await db.playerState.findUnique({ where: { playerId } }))) {
    console.error(`no player "${playerId}" yet: join the game first`);
    process.exit(1);
  }
  const wallet = new WalletService(new Ledger(db));
  await wallet.credit({
    playerId,
    currency: "NGN",
    amount: BigInt(naira) * 100n,
    reason: "family_help",
    reference: `dev-grant:${playerId}:${randomUUID()}`,
  });
  const balance = await wallet.getBalance(playerId, "NGN");
  console.log(`gave ${playerId} ${formatNaira(naira * 100)}; balance now ${formatNaira(balance)}`);
} finally {
  await db.$disconnect();
}
