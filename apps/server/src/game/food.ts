import { randomUUID } from "node:crypto";
import { InsufficientFundsError } from "../economy/money";
import type { GameDeps } from "./deps";
import type { EventService } from "./events";
import { type Outcome, reject } from "./outcome";
import type { PlayerService } from "./players";

/** Buying food: costs money (higher during a price rise), refills hunger and a little energy. */
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

    const meters = this.players.currentMeters(state, now);
    if (meters.hunger >= 100) return reject("already_full");

    const { foodPricePercent } = await this.events.activeEffects(playerId, now);
    const price = priceWithRise(item.priceKobo, quantity, foodPricePercent);

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

    await this.players.saveMeters(
      playerId,
      {
        hunger: Math.min(100, meters.hunger + item.hungerRestored * quantity),
        energy: Math.min(100, meters.energy + item.energyRestored * quantity),
      },
      now,
    );
    return { ok: true, priceKobo: price };
  }
}

/** Total price in kobo, rounded up to a whole kobo so a price rise never rounds in the player's favour. */
export function priceWithRise(unitKobo: number, quantity: number, risePercent: number): bigint {
  const base = BigInt(unitKobo) * BigInt(quantity) * BigInt(100 + risePercent);
  return (base + 99n) / 100n;
}
