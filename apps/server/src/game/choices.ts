import type { EventChoice } from "@japalife/db";
import {
  type EventAnswer,
  type GameEventConfig,
  type GameEventId,
  type PendingChoice,
  withAmount,
} from "@japalife/shared";
import { InsufficientFundsError } from "../economy/money";
import type { GameDeps } from "./deps";
import { type Outcome, reject } from "./outcome";
import type { PlayerService } from "./players";

type RequestEffect = Extract<GameEventConfig["effect"], { type: "request" }>;

/** What happened to a request, as a toast for the player. */
export interface ChoiceResult {
  playerId: string;
  title: string;
  message: string;
}

/**
 * Requests the player answers (black tax: pay or decline). EventService asks;
 * this answers, or expires the ones left too long. Every answer first claims
 * the request with a conditional update (`answer` is still null), so a double
 * tap, two tabs, or an answer racing the expiry job can only ever settle it once.
 */
export class ChoiceService {
  constructor(
    private readonly deps: GameDeps,
    private readonly players: PlayerService,
  ) {}

  /** The request waiting for an answer, as the HUD's event card shows it. */
  async pending(playerId: string, now: Date): Promise<PendingChoice | null> {
    const choice = await this.deps.db.eventChoice.findFirst({
      where: { playerId, answer: null, expiresAt: { gt: now } },
      orderBy: { askedAt: "asc" },
    });
    if (!choice) return null;
    const { event, effect } = this.requestFor(choice);
    return {
      choiceId: choice.id,
      title: event.title,
      message: withAmount(effect.asks[choice.variant] ?? effect.asks[0] ?? event.message, choice.amountKobo),
      amountKobo: Number(choice.amountKobo),
      expiresAt: choice.expiresAt.toISOString(),
      payLabel: effect.payLabel,
      declineLabel: effect.declineLabel,
    };
  }

  async answer(playerId: string, choiceId: string, answer: EventAnswer, now: Date): Promise<Outcome<ChoiceResult>> {
    const { db, wallet } = this.deps;
    const choice = await db.eventChoice.findUnique({ where: { id: choiceId } });
    // Someone else's request looks exactly like a missing one.
    if (!choice || choice.playerId !== playerId) return reject("unknown_target");
    if (choice.answer !== null) return reject("already_answered");
    if (now >= choice.expiresAt) {
      await this.expire(choice, now);
      return reject("choice_expired");
    }
    const { event, effect } = this.requestFor(choice);

    if (!(await this.claim(choice.id, answer, now))) return reject("already_answered");

    if (answer === "pay") {
      try {
        await wallet.debit({
          playerId,
          currency: "NGN",
          amount: choice.amountKobo,
          reason: effect.reason,
          // From the request, so a retry can never pay twice.
          reference: `event:${choice.id}`,
        });
      } catch (error) {
        // Not paid: give the request back so the player can still decline.
        await db.eventChoice.updateMany({ where: { id: choice.id, answer: "pay" }, data: { answer: null, answeredAt: null } });
        if (error instanceof InsufficientFundsError) return reject("insufficient_funds");
        throw error;
      }
      await db.eventFiring.update({ where: { id: choice.firingId }, data: { amountKobo: choice.amountKobo } });
      await this.players.applyChange(playerId, { family: effect.pay.familyChange, morale: effect.pay.moraleChange }, now);
      return { ok: true, playerId, title: event.title, message: withAmount(effect.pay.message, choice.amountKobo) };
    }

    const outcome = await this.declineOutcome(choice, effect);
    await this.players.applyChange(playerId, { family: outcome.familyChange, morale: outcome.moraleChange }, now);
    return { ok: true, playerId, title: event.title, message: withAmount(outcome.message, choice.amountKobo) };
  }

  /** Players with a request past its time, for the scheduled job. */
  async playersWithExpired(now: Date): Promise<string[]> {
    const rows = await this.deps.db.eventChoice.findMany({
      where: { answer: null, expiresAt: { lte: now } },
      select: { playerId: true },
      distinct: ["playerId"],
    });
    return rows.map((row) => row.playerId);
  }

  /**
   * Settles this player's requests that ran out: they count as declined.
   * Run it under the player's mutex, since it changes their meters.
   */
  async expireDue(playerId: string, now: Date): Promise<ChoiceResult[]> {
    const due = await this.deps.db.eventChoice.findMany({
      where: { playerId, answer: null, expiresAt: { lte: now } },
    });
    const results: ChoiceResult[] = [];
    for (const choice of due) {
      const result = await this.expire(choice, now);
      if (result) results.push(result);
    }
    return results;
  }

  private async expire(choice: EventChoice, now: Date): Promise<ChoiceResult | null> {
    if (!(await this.claim(choice.id, "expired", now))) return null;
    const { event, effect } = this.requestFor(choice);
    const outcome = await this.declineOutcome(choice, effect);
    await this.players.applyChange(choice.playerId, { family: outcome.familyChange, morale: outcome.moraleChange }, now);
    return { playerId: choice.playerId, title: event.title, message: withAmount(effect.expiredMessage, choice.amountKobo) };
  }

  /** Saying no hurts less when the player could not have paid anyway. */
  private async declineOutcome(choice: EventChoice, effect: RequestEffect) {
    const balance = await this.deps.wallet.getBalance(choice.playerId, "NGN");
    return balance < choice.amountKobo ? effect.declineBroke : effect.decline;
  }

  /** Marks the request answered if nobody has yet. False means someone else got there first. */
  private async claim(choiceId: string, answer: EventAnswer | "expired", now: Date): Promise<boolean> {
    const { count } = await this.deps.db.eventChoice.updateMany({
      where: { id: choiceId, answer: null },
      data: { answer, answeredAt: now },
    });
    return count === 1;
  }

  private requestFor(choice: EventChoice): { event: GameEventConfig; effect: RequestEffect } {
    const event = this.deps.content.events[choice.eventId as GameEventId];
    if (event?.effect.type !== "request") {
      throw new Error(`event ${choice.eventId} no longer asks a question`);
    }
    return { event, effect: event.effect };
  }
}
