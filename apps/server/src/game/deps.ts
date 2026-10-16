import type { PrismaClient } from "@japalife/db";
import type { GameContent } from "../content/loadContent";
import type { WalletService } from "../economy/wallet";
import type { GameClock, NightHours } from "./clock";

/** What every game system needs. Passed in, so tests can swap the clock, RNG and database. */
export interface GameDeps {
  db: PrismaClient;
  /** Game code moves money only through the WalletService, never the Ledger. */
  wallet: WalletService;
  clock: GameClock;
  content: GameContent;
  /** Returns a number in [0, 1). Injectable so event tests are deterministic. */
  rng: () => number;
  /** IANA time zone for calendar logic (daily limits reset at midnight here). */
  timeZone: string;
  /** When night falls and ends in that zone. */
  night: NightHours;
}
