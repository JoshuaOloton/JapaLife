import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loadContent";
import { priceWithRise } from "./food";
import { describeOffer } from "./offers";

const content = loadContent();
const yaba = content.cities["lagos"]!.districts[0]!;
const place = (id: string) => yaba.interactables.find((thing) => thing.id === id)!;

describe("describeOffer", () => {
  it("shows the menu at the raised price during a food price rise, the same price the purchase charges", () => {
    const offer = describeOffer(place("mama-put-buka"), content, 25);
    if (offer.kind !== "food_vendor") throw new Error("expected a menu");
    const jollof = content.ngn.food.find((item) => item.id === "jollof-rice")!;
    const shown = offer.menu.find((item) => item.itemId === "jollof-rice")!;
    expect(BigInt(shown.priceKobo)).toBe(priceWithRise(jollof.priceKobo, 1, 25));
    expect(shown.priceKobo).toBeGreaterThan(jollof.priceKobo);
  });

  it("lists only what this vendor sells", () => {
    const offer = describeOffer(place("mama-put-buka"), content, 0);
    if (offer.kind !== "food_vendor") throw new Error("expected a menu");
    const vendor = place("mama-put-buka");
    expect(offer.menu.map((item) => item.itemId)).toEqual(vendor.kind === "food_vendor" ? vendor.foodIds : []);
  });

  it("describes places with nothing to offer yet by kind only", () => {
    expect(describeOffer(place("yaba-fuel-station"), content, 0)).toEqual({
      targetId: "yaba-fuel-station",
      kind: "fuel_station",
    });
  });
});
