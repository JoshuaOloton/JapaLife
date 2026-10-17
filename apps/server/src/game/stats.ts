import type { StatsMessage } from "@japalife/shared";
import type { ChoiceService } from "./choices";
import { calendarDay, isNight } from "./clock";
import type { GameDeps } from "./deps";
import type { EventService } from "./events";
import type { JobService } from "./jobs";
import { displayNeeds, isLowMorale } from "./needs";
import type { PlayerService } from "./players";
import { risePercent } from "./prices";
import type { RentService } from "./rent";

/** Builds the snapshot the HUD shows. Read-only: it changes nothing. */
export class StatsService {
  constructor(
    private readonly deps: GameDeps,
    private readonly players: PlayerService,
    private readonly jobs: JobService,
    private readonly rent: RentService,
    private readonly events: EventService,
    private readonly choices: ChoiceService,
  ) {}

  async build(playerId: string, now: Date): Promise<StatsMessage | null> {
    const { wallet, content, timeZone, night } = this.deps;
    const state = await this.players.getState(playerId);
    if (!state) return null;

    const [balance, active, shiftsToday, effects, current, pendingChoice] = await Promise.all([
      wallet.getBalance(playerId, "NGN"),
      this.jobs.activeShift(playerId, now),
      this.jobs.shiftsToday(playerId, now),
      this.events.activeEffects(playerId, now),
      this.players.currentNeeds(state, now),
      this.choices.pending(playerId, now),
    ]);
    const shown = displayNeeds(current);

    return {
      serverTime: now.toISOString(),
      // Safe as a number: balances are capped below Number.MAX_SAFE_INTEGER.
      balanceKobo: Number(balance),
      hunger: shown.hunger,
      energy: shown.energy,
      morale: shown.morale,
      family: Math.floor(state.family),
      lowMorale: isLowMorale(current.morale, content.needs),
      timeZone,
      startedOn: calendarDay(state.createdAt, timeZone),
      isNight: isNight(now, timeZone, night),
      generatorFuelHours: shown.generatorFuelHours,
      rentDueAt: state.rentDueAt.toISOString(),
      rentStatus: this.rent.status(state.rentDueAt, now),
      rentAmountKobo: content.ngn.rent.amountKobo,
      activeShift: active ? { jobId: active.jobId, endsAt: active.endsAt.toISOString() } : null,
      shiftsToday,
      // Phase 1 has one job; with more, the cap becomes per job.
      maxShiftsToday: content.jobs.jobs.reduce((sum, job) => sum + job.maxShiftsPerDay, 0),
      blackoutEndsAt: effects.blackoutEndsAt?.toISOString() ?? null,
      foodPriceRisePercent: risePercent(effects.priceFactorBp.food),
      fuelPriceRisePercent: risePercent(effects.priceFactorBp.fuel),
      pendingChoice,
    };
  }
}
