import type { Building } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { isWindowLit, streetPower, windowsOf } from "./windows";

const building = (id: string, overrides: Partial<Building> = {}): Building => ({
  id, name: "Flats", x: 0, z: 0, halfWidth: 6, halfDepth: 5, height: 10, colour: "#ffffff", rotation: 0, scale: 1, ...overrides,
});

describe("windowsOf", () => {
  it("puts windows on the walls the camera can see, never the north wall", () => {
    const spots = windowsOf(building("flats"));
    expect(spots.length).toBeGreaterThan(0);
    expect(spots.every((spot) => spot.z > -5)).toBe(true);
  });

  it("keeps every window below the roof", () => {
    for (const height of [2.5, 4, 9, 12]) {
      expect(windowsOf(building("b", { height })).every((spot) => spot.y + 0.6 < height)).toBe(true);
    }
  });

  it("gives a tall building more floors of windows", () => {
    expect(windowsOf(building("b", { height: 12 })).length).toBeGreaterThan(windowsOf(building("b", { height: 4 })).length);
  });

  it("is the same every time, so the same windows stay lit", () => {
    expect(windowsOf(building("flats"))).toEqual(windowsOf(building("flats")));
  });
});

describe("isWindowLit", () => {
  const street = Array.from({ length: 12 }, (_, index) => windowsOf(building(`b${index}`))).flat();
  const share = (power: "day" | "night" | "blackout") => street.filter((spot) => isWindowLit(spot, power)).length / street.length;

  it("lights no windows by day, most at night, and only a few in a power cut", () => {
    expect(share("day")).toBe(0);
    expect(share("night")).toBeGreaterThan(0.45);
    expect(share("blackout")).toBeGreaterThan(0);
    expect(share("blackout")).toBeLessThan(share("night") / 2);
  });

  it("in a power cut, only lights buildings that have a generator", () => {
    const lit = street.filter((spot) => isWindowLit(spot, "blackout"));
    expect(lit.every((spot) => spot.buildingHash < 0.35)).toBe(true);
  });
});

describe("streetPower", () => {
  const now = Date.parse("2026-10-19T20:00:00Z");
  it("is day by day, even in a power cut", () => {
    expect(streetPower(false, "2026-10-19T23:00:00Z", now)).toBe("day");
  });
  it("is a blackout at night while the cut lasts, then night again", () => {
    expect(streetPower(true, "2026-10-19T23:00:00Z", now)).toBe("blackout");
    expect(streetPower(true, "2026-10-19T19:00:00Z", now)).toBe("night");
    expect(streetPower(true, null, now)).toBe("night");
  });
});
