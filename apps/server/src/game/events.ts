import { GAME_EVENT_IDS, type GameEventConfig, type GameEventId, type PriceCategory } from "@japalife/shared";
import { addDays, MS_PER_DAY, MS_PER_HOUR } from "./clock";
import type { GameDeps } from "./deps";
import type { PlayerService } from "./players";
import { compoundRise, NO_RISE_BP } from "./prices";

export interface FiredEvent {
  eventId: string;
  title: string;
  message: string;
  /** The event asks the player something: the HUD shows its card, so no toast is needed. */
  asksChoice: boolean;
}

export interface ActiveEffects {
  /** When the current power cut ends, or null if the lights are on. */
  blackoutEndsAt: Date | null;
  /** Whether the current power cut also stops work. */
  blackoutBlocksShifts: boolean;
  /** Every price rise so far, compounded, per category (basis points; 10,000 = no rise). */
  priceFactorBp: Record<PriceCategory, bigint>;
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
  constructor(
    private readonly deps: GameDeps,
    private readonly players: PlayerService,
  ) {}

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
      // One question at a time: no new request while the last is unanswered.
      if (event.effect.type === "request" && (await db.eventChoice.count({ where: { playerId, answer: null } })) > 0) {
        continue;
      }

      // Chance of at least one occurrence over the elapsed time, given a daily chance.
      const chance = 1 - Math.pow(1 - event.chancePerDay, elapsedDays);
      if (rng() >= chance) continue;

      await this.fire(playerId, event, now);
      fired.push({
        eventId: event.id,
        title: event.title,
        message: event.message,
        asksChoice: event.effect.type === "request",
      });
    }

    await db.playerState.update({ where: { playerId }, data: { eventsCheckedAt: now } });
    return fired;
  }

  /**
   * Fires one event straight away, skipping the dice and the gap. For play-testing
   * only (`pnpm fire-event`); the game itself only fires through `processDue`.
   * Still asks one question at a time.
   */
  async fireNow(playerId: string, eventId: GameEventId, now: Date): Promise<boolean> {
    const event = this.deps.content.events[eventId];
    const waiting = await this.deps.db.eventChoice.count({ where: { playerId, answer: null } });
    if (event.effect.type === "request" && waiting > 0) return false;
    await this.fire(playerId, event, now);
    return true;
  }

  /**
   * Effects still in force at `now`: a running power cut, and every price rise
   * so far (permanent ones have no end), compounded in the order they happened.
   */
  async activeEffects(playerId: string, now: Date): Promise<ActiveEffects> {
    const { db, content } = this.deps;
    const priceRiseIds = Object.values(content.events)
      .filter((event) => event.effect.type === "price_rise")
      .map((event) => event.id);
    const firings = await db.eventFiring.findMany({
      where: {
        playerId,
        firedAt: { lte: now },
        OR: [{ endsAt: { gt: now } }, { endsAt: null, eventId: { in: priceRiseIds } }],
      },
      orderBy: { firedAt: "asc" },
    });

    const effects: ActiveEffects = {
      blackoutEndsAt: null,
      blackoutBlocksShifts: false,
      priceFactorBp: { food: NO_RISE_BP, fuel: NO_RISE_BP },
    };
    for (const firing of firings) {
      const effect = content.events[firing.eventId as GameEventId]?.effect;
      if (!effect) continue;
      if (effect.type === "blackout" && firing.endsAt) {
        if (!effects.blackoutEndsAt || firing.endsAt > effects.blackoutEndsAt) effects.blackoutEndsAt = firing.endsAt;
        effects.blackoutBlocksShifts ||= effect.blocksShifts;
      } else if (effect.type === "price_rise") {
        effects.priceFactorBp[effect.category] = compoundRise(effects.priceFactorBp[effect.category], effect.percent);
      }
    }
    return effects;
  }

  private async fire(playerId: string, event: GameEventConfig, now: Date): Promise<void> {
    await this.applyEffect(playerId, event, now);
    if (event.moraleChange !== 0) await this.players.applyChange(playerId, { morale: event.moraleChange }, now);
  }

  private async applyEffect(playerId: string, event: GameEventConfig, now: Date): Promise<void> {
    const { db, rng } = this.deps;
    const effect = event.effect;

    if (effect.type === "request") {
      // Nothing is taken yet: the player is asked, and answers through ChoiceService.
      const asked = effect.minKobo + Math.floor(rng() * (effect.maxKobo - effect.minKobo + 1));
      const variant = Math.min(effect.asks.length - 1, Math.floor(rng() * effect.asks.length));
      await db.$transaction(async (tx) => {
        const firing = await tx.eventFiring.create({
          data: { playerId, eventId: event.id, firedAt: now, amountKobo: 0n },
        });
        await tx.eventChoice.create({
          data: {
            playerId,
            firingId: firing.id,
            eventId: event.id,
            amountKobo: BigInt(asked),
            variant,
            askedAt: now,
            expiresAt: new Date(now.getTime() + effect.answerWithinHours * MS_PER_HOUR),
          },
        });
      });
      return;
    }

    // A price rise without a duration is permanent: no end date.
    const endsAt =
      effect.type === "blackout"
        ? new Date(now.getTime() + effect.durationMinutes * (MS_PER_HOUR / 60))
        : effect.durationDays === undefined
          ? null
          : addDays(now, effect.durationDays);
    await db.eventFiring.create({
      data: { playerId, eventId: event.id, firedAt: now, endsAt },
    });
  }
}
