import { randomUUID } from "node:crypto";
import { InsufficientFundsError } from "../economy/money";
import type { GameDeps } from "./deps";
import type { EventService } from "./events";
import { type Outcome, reject } from "./outcome";
import type { PlayerService } from "./players";
import { priceWithFactor } from "./prices";

/** Buying food: costs money (more after price rises), refills hunger, a little energy, and lifts morale. */
export class FoodService {
  constructor(
    private readonly deps: GameDeps,
    private readonly players: PlayerService,
    private readonly events: EventService,
  ) {}

  async buy(
    playerId: string,
    itemId: string,
    quantity: number,
    now: Date,
  ): Promise<Outcome<{ priceKobo: bigint }>> {
    const { wallet, content } = this.deps;
    const item = content.ngn.food.find((candidate) => candidate.id === itemId);
    if (!item) return reject("unknown_target");

    const state = await this.players.getState(playerId);
    if (!state) return reject("not_signed_in");

    const needs = await this.players.currentNeeds(state, now);
    // The meal has to fit: hunger counts as the whole number the HUD shows.
    const fillsTo = Math.floor(needs.hunger) + item.hungerRestored * quantity;
    if (fillsTo > 100 + content.needs.overeatAllowance) return reject("already_full");

    const { priceFactorBp } = await this.events.activeEffects(playerId, now);
    const price = priceWithFactor(item.priceKobo, quantity, priceFactorBp.food);

    try {
      await wallet.debit({
        playerId,
        currency: "NGN",
        amount: price,
        reason: "food",
        // One id per purchase intent: the server handles each intent once.
        reference: `food:${playerId}:${randomUUID()}`,
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) return reject("insufficient_funds");
      throw error;
    }

    await this.players.applyChange(
      playerId,
      {
        hunger: item.hungerRestored * quantity,
        energy: item.energyRestored * quantity,
        morale: item.moraleRestored * quantity,
      },
      now,
    );
    return { ok: true, priceKobo: price };
  }
}
