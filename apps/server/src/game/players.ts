import type { PlayerState } from "@japalife/db";
import { addDays, nightIntervals } from "./clock";
import type { GameDeps } from "./deps";
import { needsAt, type Needs } from "./needs";

/** A change to the player's meters or family relationship, added to the current values and clamped. */
export interface NeedsChange {
  hunger?: number;
  energy?: number;
  morale?: number;
  generatorFuelHours?: number;
  family?: number;
}

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
    const { needs } = content;
    await db.playerState.upsert({
      where: { playerId },
      update: {},
      create: {
        playerId,
        hunger: needs.startingHunger,
        energy: needs.startingEnergy,
        morale: needs.startingMorale,
        generatorFuelHours: 0,
        family: needs.startingFamily,
        statsAt: now,
        rentDueAt: addDays(now, content.ngn.rent.periodDays),
        eventsCheckedAt: now,
        // Game time, not the database's clock: "Day 1" starts here, also under GAME_CLOCK.
        createdAt: now,
      },
    });
  }

  getState(playerId: string): Promise<PlayerState | null> {
    return this.deps.db.playerState.findUnique({ where: { playerId } });
  }

  /** The meters right now, computed from the stored values and what happened since (nights, power cuts). */
  async currentNeeds(state: PlayerState, now: Date): Promise<Needs> {
    const { content, timeZone, night } = this.deps;
    return needsAt(state, now, content.needs, {
      nights: nightIntervals(state.statsAt, now, timeZone, night),
      blackouts: await this.blackoutsSince(state.playerId, state.statsAt, now),
    });
  }

  /** Stores new meter values as of `now`. */
  saveNeeds(playerId: string, needs: Needs, now: Date): Promise<PlayerState> {
    return this.deps.db.playerState.update({
      where: { playerId },
      data: { ...needs, statsAt: now },
    });
  }

  /**
   * Brings the meters up to `now`, adds `change` and saves. Callers serialise a
   * player's work (the room's KeyedMutex), so read-then-write is safe here.
   */
  async applyChange(playerId: string, change: NeedsChange, now: Date): Promise<void> {
    const state = await this.getState(playerId);
    if (!state) return;
    const current = await this.currentNeeds(state, now);
    const clamp = (value: number): number => Math.min(100, Math.max(0, value));
    await this.deps.db.playerState.update({
      where: { playerId },
      data: {
        hunger: clamp(current.hunger + (change.hunger ?? 0)),
        energy: clamp(current.energy + (change.energy ?? 0)),
        morale: clamp(current.morale + (change.morale ?? 0)),
        generatorFuelHours: Math.max(0, current.generatorFuelHours + (change.generatorFuelHours ?? 0)),
        family: clamp(state.family + (change.family ?? 0)),
        statsAt: now,
      },
    });
  }

  /** Power cuts that overlap [from, to). */
  private async blackoutsSince(playerId: string, from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
    const { db, content } = this.deps;
    const blackoutEventIds = Object.values(content.events)
      .filter((event) => event.effect.type === "blackout")
      .map((event) => event.id);
    const firings = await db.eventFiring.findMany({
      where: { playerId, eventId: { in: blackoutEventIds }, firedAt: { lt: to }, endsAt: { gt: from } },
      select: { firedAt: true, endsAt: true },
    });
    return firings.flatMap((firing) => (firing.endsAt ? [{ start: firing.firedAt, end: firing.endsAt }] : []));
  }
}
