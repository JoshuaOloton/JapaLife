import { randomUUID } from "node:crypto";
import { InsufficientFundsError } from "../economy/money";
import type { GameDeps } from "./deps";
import type { EventService } from "./events";
import { type Outcome, reject } from "./outcome";
import type { PlayerService } from "./players";
import { priceWithFactor } from "./prices";

/**
 * Buying goods at a shop. In Phase 1 that is petrol for the generator: each
 * unit adds running time to the player's tank, which the generator burns only
 * at night during a power cut.
 */
export class ShopService {
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
  ): Promise<Outcome<{ priceKobo: bigint; generatorFuelHours: number }>> {
    const { wallet, content } = this.deps;
    const item = content.ngn.shop.find((candidate) => candidate.id === itemId);
    if (!item) return reject("unknown_target");

    const state = await this.players.getState(playerId);
    if (!state) return reject("not_signed_in");

    // Checked before paying, so a full jerrycan never costs money.
    const { generatorFuelHours } = await this.players.currentNeeds(state, now);
    const added = item.generatorHours * quantity;
    if (generatorFuelHours + added > content.needs.generatorTankHours + 1e-9) return reject("tank_full");

    const { priceFactorBp } = await this.events.activeEffects(playerId, now);
    const price = priceWithFactor(item.priceKobo, quantity, priceFactorBp[item.priceCategory]);

    try {
      await wallet.debit({
        playerId,
        currency: "NGN",
        amount: price,
        reason: item.reason,
        // One id per purchase intent: the server handles each intent once.
        reference: `shop:${playerId}:${randomUUID()}`,
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) return reject("insufficient_funds");
      throw error;
    }

    await this.players.applyChange(playerId, { generatorFuelHours: added }, now);
    return { ok: true, priceKobo: price, generatorFuelHours: generatorFuelHours + added };
  }
}
