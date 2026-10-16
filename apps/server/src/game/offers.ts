import type { Interactable, InteractionMessage, MenuItem, NeedsConfig, PriceCategory, ShopOffer } from "@japalife/shared";
import type { GameContent } from "../content/loadContent";
import { shiftPay } from "./jobs";
import { priceWithFactor } from "./prices";

/** What the offer depends on right now: price rises and the player's morale. */
export interface OfferContext {
  priceFactorBp: Record<PriceCategory, bigint>;
  morale: number;
}

/**
 * What a place offers, for the `interaction` reply. Prices and pay are computed
 * here with the same functions the purchase and the shift use, so what is shown
 * is what is charged or paid.
 */
export function describeOffer(target: Interactable, content: GameContent, context: OfferContext): InteractionMessage {
  const needs: NeedsConfig = content.needs;
  switch (target.kind) {
    case "job_site": {
      const job = content.jobs.jobs.find((candidate) => candidate.id === target.jobId);
      // loadContent checks every job site points at a real job, so this cannot happen at runtime.
      if (!job) throw new Error(`job site ${target.id} has no job ${target.jobId}`);
      return {
        targetId: target.id,
        kind: "job_site",
        job: {
          jobId: job.id,
          name: job.name,
          // Safe as a number: one shift's pay is far below the balance cap.
          payKobo: Number(shiftPay(job.shiftPayKobo, context.morale, needs)),
          shiftMinutes: job.shiftMinutes,
          energyCost: job.energyCost,
        },
      };
    }
    case "food_vendor": {
      const menu: MenuItem[] = [];
      for (const itemId of target.foodIds) {
        const item = content.ngn.food.find((candidate) => candidate.id === itemId);
        if (!item) continue;
        menu.push({
          itemId: item.id,
          name: item.name,
          // Safe as a number: one portion is far below the balance cap.
          priceKobo: Number(priceWithFactor(item.priceKobo, 1, context.priceFactorBp.food)),
          hungerRestored: item.hungerRestored,
          energyRestored: item.energyRestored,
        });
      }
      return { targetId: target.id, kind: "food_vendor", menu };
    }
    case "fuel_station": {
      const items: ShopOffer[] = [];
      for (const itemId of target.shopItemIds) {
        const item = content.ngn.shop.find((candidate) => candidate.id === itemId);
        if (!item) continue;
        items.push({
          itemId: item.id,
          name: item.name,
          priceKobo: Number(priceWithFactor(item.priceKobo, 1, context.priceFactorBp[item.priceCategory])),
          generatorHours: item.generatorHours,
        });
      }
      return { targetId: target.id, kind: "fuel_station", items };
    }
    case "home":
    case "bus_stop":
      return { targetId: target.id, kind: target.kind };
  }
}
