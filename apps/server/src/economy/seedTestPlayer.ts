import type { PrismaClient } from "@japalife/db";
import type { WalletService } from "./wallet";

/** One fixed player for manual play-testing and tests. Never a real account. */
export const SEED_TEST_PLAYER_ID = "seed-test-player";

/** 50,000 naira. Money is in kobo (100 kobo = 1 naira), so this is 5,000,000. */
export const SEED_TEST_PLAYER_BALANCE = 5_000_000n;

/**
 * Creates the test player and gives them their starting balance through the
 * ledger, like any other money. Safe to run repeatedly: the player is upserted
 * and the deterministic reference stops the balance being paid twice.
 */
export async function seedTestPlayer(db: PrismaClient, wallet: WalletService): Promise<string> {
  await db.player.upsert({
    where: { id: SEED_TEST_PLAYER_ID },
    update: {},
    create: { id: SEED_TEST_PLAYER_ID },
  });
  await wallet.credit({
    playerId: SEED_TEST_PLAYER_ID,
    currency: "NGN",
    amount: SEED_TEST_PLAYER_BALANCE,
    reason: "starting_balance",
    reference: `seed:starting_balance:${SEED_TEST_PLAYER_ID}`,
  });
  return SEED_TEST_PLAYER_ID;
}
