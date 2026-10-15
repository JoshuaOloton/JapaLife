import { GAME_EVENT_IDS, type GameEventConfig, type GameEventId } from "@japalife/shared";
import { InsufficientFundsError } from "../economy/money";
import { addDays, MS_PER_DAY, MS_PER_HOUR } from "./clock";
import type { GameDeps } from "./deps";

export interface FiredEvent {
  eventId: string;
  title: string;
  message: string;
}

export interface ActiveEffects {
  /** When the current power cut ends, or null if the lights are on. */
  blackoutEndsAt: Date | null;
  /** Percent added to food prices right now (the biggest active rise). */
  foodPricePercent: number;
}

/** Ignore checks closer together than this: too little time has passed to matter. */
const MIN_CHECK_GAP_MS = 1000;

/**
 * Random life events (black tax, power cuts, price rises). They are evaluated
 * lazily from timestamps: when a player is online the room asks every so often,
 * and on join it catches up for the time they were away, firing each event at
 * most once. Effects with a duration are read back from the database, so a
 * restart does not lose a power cut.
 */
export class EventService {
  constructor(private readonly deps: GameDeps) {}

  async processDue(playerId: string, now: Date): Promise<FiredEvent[]> {
    const { db, content, rng } = this.deps;
    const state = await db.playerState.findUnique({ where: { playerId } });
    if (!state) return [];

    const elapsedMs = now.getTime() - state.eventsCheckedAt.getTime();
    if (elapsedMs < MIN_CHECK_GAP_MS) return [];
    const elapsedDays = elapsedMs / MS_PER_DAY;

    const fired: FiredEvent[] = [];
    for (const eventId of GAME_EVENT_IDS) {
      const event = content.events[eventId];
      const last = await db.eventFiring.findFirst({
        where: { playerId, eventId },
        orderBy: { firedAt: "desc" },
      });
      if (last && now.getTime() < addDays(last.firedAt, event.minGapDays).getTime()) continue;

      // Chance of at least one occurrence over the elapsed time, given a daily chance.
      const chance = 1 - Math.pow(1 - event.chancePerDay, elapsedDays);
      if (rng() >= chance) continue;

      await this.fire(playerId, event, now);
      fired.push({ eventId: event.id, title: event.title, message: event.message });
    }

    await db.playerState.update({ where: { playerId }, data: { eventsCheckedAt: now } });
    return fired;
  }

  /** Effects with a duration that are still running at `now`. */
  async activeEffects(playerId: string, now: Date): Promise<ActiveEffects> {
    const running = await this.deps.db.eventFiring.findMany({
      where: { playerId, endsAt: { gt: now } },
    });
    const effects: ActiveEffects = { blackoutEndsAt: null, foodPricePercent: 0 };
    for (const firing of running) {
      const effect = this.deps.content.events[firing.eventId as GameEventId]?.effect;
      if (!effect || !firing.endsAt) continue;
      if (effect.type === "blackout") {
        if (!effects.blackoutEndsAt || firing.endsAt > effects.blackoutEndsAt) {
          effects.blackoutEndsAt = firing.endsAt;
        }
      } else if (effect.type === "price_rise" && effect.category === "food") {
        effects.foodPricePercent = Math.max(effects.foodPricePercent, effect.percent);
      }
    }
    return effects;
  }

  private async fire(playerId: string, event: GameEventConfig, now: Date): Promise<void> {
    const { db, wallet, rng } = this.deps;
    const effect = event.effect;

    if (effect.type === "debit") {
      const firing = await db.eventFiring.create({
        data: { playerId, eventId: event.id, firedAt: now, amountKobo: 0n },
      });
      const asked = effect.minKobo + Math.floor(rng() * (effect.maxKobo - effect.minKobo + 1));
      // Black tax takes what the player can spare: never more than they hold.
      const balance = await wallet.getBalance(playerId, "NGN");
      const amount = balance < BigInt(asked) ? balance : BigInt(asked);
      if (amount <= 0n) return;
      try {
        await wallet.debit({
          playerId,
          currency: "NGN",
          amount,
          reason: effect.reason,
          reference: `event:${firing.id}`,
        });
      } catch (error) {
        // The balance dropped between the check and the debit: nothing was taken.
        if (error instanceof InsufficientFundsError) return;
        throw error;
      }
      await db.eventFiring.update({ where: { id: firing.id }, data: { amountKobo: amount } });
      return;
    }

    const endsAt =
      effect.type === "blackout"
        ? new Date(now.getTime() + effect.durationMinutes * (MS_PER_HOUR / 60))
        : addDays(now, effect.durationDays);
    await db.eventFiring.create({
      data: { playerId, eventId: event.id, firedAt: now, endsAt },
    });
  }
}
