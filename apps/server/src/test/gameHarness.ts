import type { PrismaClient } from "@japalife/db";
import { loadContent, type GameContent } from "../content/loadContent";
import { Ledger } from "../economy/ledger";
import { WalletService } from "../economy/wallet";
import { ManualClock } from "../game/clock";
import { createGameSystems, type GameSystems } from "../game";
import { createTestClient, resetLedgerTables } from "./testDb";

export interface Harness {
  db: PrismaClient;
  /** For setting up a player's money in tests. Game code under test uses its own copy. */
  wallet: WalletService;
  game: GameSystems;
  clock: ManualClock;
  content: GameContent;
  /** Sets what the next random draws return. Defaults to always 0 (events always fire, minimum amounts). */
  setRng(values: number | number[]): void;
  close(): Promise<void>;
}

/**
 * A real game (real Postgres test database, real content) with a clock the test
 * controls and a scripted random number generator. Empties the database first.
 */
export async function createHarness(
  tweakContent?: (content: GameContent) => void,
): Promise<Harness> {
  const db = createTestClient(10);
  await resetLedgerTables(db);

  const content = loadContent();
  tweakContent?.(content);

  const clock = new ManualClock();
  const wallet = new WalletService(new Ledger(db));
  let queue: number[] = [];
  let fallback = 0;
  const game = createGameSystems({
    db,
    content,
    clock,
    wallet,
    rng: () => (queue.length > 0 ? (queue.shift() as number) : fallback),
  });

  return {
    db,
    wallet,
    game,
    clock,
    content,
    setRng(values) {
      if (Array.isArray(values)) queue = [...values];
      else {
        queue = [];
        fallback = values;
      }
    },
    close: () => db.$disconnect(),
  };
}

/** Moves every thing in the first Lagos district to the spawn point, so tests need no walking. */
export function gatherEverythingAtSpawn(content: GameContent): void {
  const district = content.cities["lagos"]?.districts[0];
  if (!district) throw new Error("no district");
  for (const thing of district.interactables) {
    thing.position = { x: district.spawn.x, z: district.spawn.z };
  }
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
