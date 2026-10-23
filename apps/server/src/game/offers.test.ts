import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loadContent";
import { shiftPay } from "./jobs";
import { describeOffer, type OfferContext } from "./offers";
import { NO_RISE_BP, priceWithFactor } from "./prices";

const content = loadContent();
const yaba = content.cities["lagos"]!.districts[0]!;
const place = (id: string) => yaba.interactables.find((thing) => thing.id === id)!;
const calm: OfferContext = { priceFactorBp: { food: NO_RISE_BP, fuel: NO_RISE_BP }, morale: 70 };

describe("describeOffer", () => {
  it("shows the menu at the raised price after a food price rise, the same price the purchase charges", () => {
    const offer = describeOffer(place("mama-put-buka"), content, { ...calm, priceFactorBp: { food: 12_500n, fuel: NO_RISE_BP } });
    if (offer.kind !== "food_vendor") throw new Error("expected a menu");
    const jollof = content.ngn.food.find((item) => item.id === "jollof-rice")!;
    const shown = offer.menu.find((item) => item.itemId === "jollof-rice")!;
    expect(BigInt(shown.priceKobo)).toBe(priceWithFactor(jollof.priceKobo, 1, 12_500n));
    expect(shown.priceKobo).toBeGreaterThan(jollof.priceKobo);
  });

  it("lists only what this vendor sells", () => {
    const offer = describeOffer(place("mama-put-buka"), content, calm);
    if (offer.kind !== "food_vendor") throw new Error("expected a menu");
    const vendor = place("mama-put-buka");
    expect(offer.menu.map((item) => item.itemId)).toEqual(vendor.kind === "food_vendor" ? vendor.foodIds : []);
  });

  it("sells petrol at the fuel station at the fuel price, not the food price", () => {
    const offer = describeOffer(place("yaba-fuel-station"), content, { ...calm, priceFactorBp: { food: 20_000n, fuel: 11_000n } });
    if (offer.kind !== "fuel_station") throw new Error("expected a shop");
    const petrol = content.ngn.shop.find((item) => item.id === "generator-petrol")!;
    expect(offer.items).toEqual([
      {
        itemId: "generator-petrol",
        name: petrol.name,
        priceKobo: Number(priceWithFactor(petrol.priceKobo, 1, 11_000n)),
        generatorHours: petrol.generatorHours,
      },
    ]);
  });

  it("shows the shift pay the player would actually get, lower when morale is low", () => {
    const job = content.jobs.jobs[0]!;
    const happy = describeOffer(place("yaba-office"), content, calm);
    const low = describeOffer(place("yaba-office"), content, { ...calm, morale: 10 });
    if (happy.kind !== "job_site" || low.kind !== "job_site") throw new Error("expected a job");
    expect(happy.job.payKobo).toBe(job.shiftPayKobo);
    expect(BigInt(low.job.payKobo)).toBe(shiftPay(job.shiftPayKobo, 10, content.needs));
    expect(low.job.payKobo).toBeLessThan(job.shiftPayKobo);
  });

  it("passes on the rides from a stop, and none when the room gave none", () => {
    const rides = [
      { rideId: "yaba-danfo", kind: "danfo" as const, toStop: "sabo-bus-stop", toLabel: "Sabo", fareKobo: 50_000, seconds: 40 },
    ];
    expect(describeOffer(place("yaba-bus-stop"), content, { ...calm, rides })).toEqual({
      targetId: "yaba-bus-stop",
      kind: "bus_stop",
      rides,
    });
    expect(describeOffer(place("yaba-bus-stop"), content, calm)).toEqual({ targetId: "yaba-bus-stop", kind: "bus_stop", rides: [] });
  });
});
