import type { PlayerState } from "@japalife/db";
import { addDays } from "./clock";
import type { GameDeps } from "./deps";
import { metersAt, type Meters } from "./needs";

/** Creates players and keeps their meters. Money still goes through the WalletService. */
export class PlayerService {
  constructor(private readonly deps: GameDeps) {}

  /**
   * Makes sure the player exists, has a state row and has received their starting
   * balance. Safe to call on every join: the starting balance uses a fixed
   * reference, so a retry or a second join can never pay it twice.
   */
  async ensurePlayer(playerId: string): Promise<void> {
    const { db, wallet, clock, content } = this.deps;
    await db.player.upsert({ where: { id: playerId }, update: {}, create: { id: playerId } });

    const existing = await db.playerState.findUnique({ where: { playerId } });
    if (existing) return;

    // Credit first: if we crash before the state row exists, the retry's credit is a no-op.
    await wallet.credit({
      playerId,
      currency: "NGN",
      amount: BigInt(content.ngn.startingBalanceKobo),
      reason: "starting_balance",
      reference: `starting_balance:${playerId}`,
    });

    const now = clock.now();
    await db.playerState.upsert({
      where: { playerId },
      update: {},
      create: {
        playerId,
        hunger: content.needs.startingHunger,
        energy: content.needs.startingEnergy,
        statsAt: now,
        rentDueAt: addDays(now, content.ngn.rent.periodDays),
        eventsCheckedAt: now,
      },
    });
  }

  getState(playerId: string): Promise<PlayerState | null> {
    return this.deps.db.playerState.findUnique({ where: { playerId } });
  }

  /** The meters right now, computed from the stored values and elapsed real time. */
  currentMeters(state: PlayerState, now: Date): Meters {
    return metersAt(state, now, this.deps.content.needs);
  }

  /** Stores new meter values as of `now`. */
  saveMeters(playerId: string, meters: Meters, now: Date): Promise<PlayerState> {
    return this.deps.db.playerState.update({
      where: { playerId },
      data: { hunger: meters.hunger, energy: meters.energy, statsAt: now },
    });
  }
}
