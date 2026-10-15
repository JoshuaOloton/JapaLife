import type { StatsMessage } from "@japalife/shared";
import type { GameDeps } from "./deps";
import type { EventService } from "./events";
import type { JobService } from "./jobs";
import { displayMeters } from "./needs";
import type { PlayerService } from "./players";
import type { RentService } from "./rent";

/** Builds the snapshot the HUD shows. Read-only: it changes nothing. */
export class StatsService {
  constructor(
    private readonly deps: GameDeps,
    private readonly players: PlayerService,
    private readonly jobs: JobService,
    private readonly rent: RentService,
    private readonly events: EventService,
  ) {}

  async build(playerId: string, now: Date): Promise<StatsMessage | null> {
    const { wallet, content } = this.deps;
    const state = await this.players.getState(playerId);
    if (!state) return null;

    const [balance, active, shiftsToday, effects] = await Promise.all([
      wallet.getBalance(playerId, "NGN"),
      this.jobs.activeShift(playerId, now),
      this.jobs.shiftsToday(playerId, now),
      this.events.activeEffects(playerId, now),
    ]);
    const { hunger, energy } = displayMeters(this.players.currentMeters(state, now));

    return {
      serverTime: now.toISOString(),
      // Safe as a number: balances are capped below Number.MAX_SAFE_INTEGER.
      balanceKobo: Number(balance),
      hunger,
      energy,
      rentDueAt: state.rentDueAt.toISOString(),
      rentStatus: this.rent.status(state.rentDueAt, now),
      rentAmountKobo: content.ngn.rent.amountKobo,
      activeShift: active ? { jobId: active.jobId, endsAt: active.endsAt.toISOString() } : null,
      shiftsToday,
      // Phase 1 has one job; with more, the cap becomes per job.
      maxShiftsToday: content.jobs.jobs.reduce((sum, job) => sum + job.maxShiftsPerDay, 0),
      blackoutEndsAt: effects.blackoutEndsAt?.toISOString() ?? null,
      foodPriceRisePercent: effects.foodPricePercent,
    };
  }
}
