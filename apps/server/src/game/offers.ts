import type { Interactable, InteractionMessage, MenuItem } from "@japalife/shared";
import type { GameContent } from "../content/loadContent";
import { priceWithRise } from "./food";

/**
 * What a place offers, for the `interaction` reply. Prices are computed here with
 * the same function the purchase uses, so the price shown is the price charged.
 */
export function describeOffer(
  target: Interactable,
  content: GameContent,
  foodPriceRisePercent: number,
): InteractionMessage {
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
          payKobo: job.shiftPayKobo,
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
          priceKobo: Number(priceWithRise(item.priceKobo, 1, foodPriceRisePercent)),
          hungerRestored: item.hungerRestored,
          energyRestored: item.energyRestored,
        });
      }
      return { targetId: target.id, kind: "food_vendor", menu };
    }
    case "home":
    case "bus_stop":
    case "fuel_station":
      return { targetId: target.id, kind: target.kind };
  }
}
