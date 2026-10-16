import type { NeedsConfig } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { isNight, nightIntervals, zonedInstant } from "./clock";
import { displayNeeds, needsAt, shiftPayPercent, type StoredNeeds } from "./needs";

const needs: NeedsConfig = {
  meta: { asOf: "2026-10-16", basis: "game-balance", status: "active" },
  startingHunger: 80,
  startingEnergy: 100,
  startingMorale: 70,
  hungerDecayPerHour: 4,
  energyRegenPerHour: 6,
  moraleRestingLevel: 60,
  moraleDriftPerHour: 1,
  lowMorale: { below: 30, energyRegenPercent: 50, shiftPayPercent: 80 },
  blackoutNightEnergyRegenPercent: 25,
  generatorTankHours: 12,
  startingFamily: 60,
};

const LAGOS = "Africa/Lagos";
const NIGHT = { startsHour: 19, endsHour: 6 };
const at = (iso: string): Date => new Date(iso);
const stored = (overrides: Partial<StoredNeeds> = {}): StoredNeeds => ({
  hunger: 80,
  energy: 40,
  morale: 70,
  generatorFuelHours: 0,
  statsAt: at("2026-10-15T08:00:00Z"),
  ...overrides,
});
const noConditions = { nights: [], blackouts: [] };

describe("needsAt", () => {
  it("drains hunger, regenerates energy and lets morale drift towards its resting level", () => {
    expect(needsAt(stored(), at("2026-10-15T13:00:00Z"), needs, noConditions)).toEqual({
      hunger: 60,
      energy: 70,
      morale: 65,
      generatorFuelHours: 0,
    });
  });

  it("stays within 0-100 and morale settles at its resting level", () => {
    const later = needsAt(stored(), at("2026-10-30T08:00:00Z"), needs, noConditions);
    expect(later).toEqual({ hunger: 0, energy: 100, morale: 60, generatorFuelHours: 0 });
    expect(needsAt(stored({ morale: 5 }), at("2026-10-30T08:00:00Z"), needs, noConditions).morale).toBe(60);
  });

  it("never runs backwards if the clock reads earlier than the stored time", () => {
    expect(needsAt(stored(), at("2026-10-14T08:00:00Z"), needs, noConditions)).toEqual({
      hunger: 80,
      energy: 40,
      morale: 70,
      generatorFuelHours: 0,
    });
  });

  describe("power cuts", () => {
    // 20:00 to midnight Lagos time (UTC+1): night all the way through.
    const from = at("2026-10-15T19:00:00Z");
    const to = at("2026-10-15T23:00:00Z");
    const conditions = {
      nights: nightIntervals(from, to, LAGOS, NIGHT),
      blackouts: [{ start: at("2026-10-15T18:30:00Z"), end: at("2026-10-16T02:00:00Z") }],
    };

    it("slow energy recovery at night when there is no fuel", () => {
      const result = needsAt(stored({ statsAt: from }), to, needs, conditions);
      expect(result.energy).toBeCloseTo(40 + 4 * 6 * 0.25); // 4 hours at a quarter of the rate
    });

    it("are beaten by the generator until its fuel runs out", () => {
      const result = needsAt(stored({ statsAt: from, generatorFuelHours: 1 }), to, needs, conditions);
      expect(result.energy).toBeCloseTo(40 + 1 * 6 + 3 * 6 * 0.25);
      expect(result.generatorFuelHours).toBe(0);
    });

    it("burn only the fuel the night needs", () => {
      const result = needsAt(stored({ statsAt: from, generatorFuelHours: 10 }), to, needs, conditions);
      expect(result.energy).toBeCloseTo(40 + 4 * 6);
      expect(result.generatorFuelHours).toBeCloseTo(6);
    });

    it("do not slow anything in the daytime, and burn no fuel", () => {
      const dayFrom = at("2026-10-15T08:00:00Z");
      const dayTo = at("2026-10-15T12:00:00Z");
      const result = needsAt(stored({ statsAt: dayFrom, generatorFuelHours: 5 }), dayTo, needs, {
        nights: nightIntervals(dayFrom, dayTo, LAGOS, NIGHT),
        blackouts: [{ start: dayFrom, end: dayTo }],
      });
      expect(result.energy).toBeCloseTo(40 + 4 * 6);
      expect(result.generatorFuelHours).toBe(5);
    });

    it("count only the part of the night they overlap", () => {
      // 17:00 to 21:00 Lagos with the lights out the whole time: 2 hours of day, 2 of night.
      const evening = at("2026-10-15T16:00:00Z");
      const later = at("2026-10-15T20:00:00Z");
      const result = needsAt(stored({ statsAt: evening }), later, needs, {
        nights: nightIntervals(evening, later, LAGOS, NIGHT),
        blackouts: [{ start: evening, end: later }],
      });
      expect(result.energy).toBeCloseTo(40 + 2 * 6 + 2 * 6 * 0.25);
    });
  });

  it("slows energy while morale is low, until morale recovers past the line", () => {
    // Morale 20 drifts up 1 an hour and crosses 30 after 10 hours: 10 hours at half rate, then 2 at full.
    const result = needsAt(stored({ energy: 0, morale: 20 }), at("2026-10-15T20:00:00Z"), needs, noConditions);
    expect(result.energy).toBeCloseTo(10 * 3 + 2 * 6);
    expect(result.morale).toBeCloseTo(32);
  });
});

describe("shiftPayPercent", () => {
  it("pays the full rate unless morale is low", () => {
    expect(shiftPayPercent(30, needs)).toBe(100);
    expect(shiftPayPercent(29.9, needs)).toBe(80);
  });
});

describe("displayNeeds", () => {
  it("rounds meters down so 0 means really empty, and fuel to a tenth of an hour", () => {
    expect(displayNeeds({ hunger: 0.9, energy: 99.9, morale: 29.99, generatorFuelHours: 1.99 })).toEqual({
      hunger: 0,
      energy: 99,
      morale: 29,
      generatorFuelHours: 1.9,
    });
  });
});

describe("local time", () => {
  it("finds the instant a local hour starts, including daylight saving", () => {
    expect(zonedInstant("2026-10-16", 19, LAGOS).toISOString()).toBe("2026-10-16T18:00:00.000Z");
    // London is on summer time (UTC+1) in October and back on GMT in November.
    expect(zonedInstant("2026-10-16", 19, "Europe/London").toISOString()).toBe("2026-10-16T18:00:00.000Z");
    expect(zonedInstant("2026-11-16", 19, "Europe/London").toISOString()).toBe("2026-11-16T19:00:00.000Z");
    expect(zonedInstant("2026-11-16", 19, "America/Toronto").toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });

  it("lists every night in a span, clipped to it", () => {
    const nights = nightIntervals(at("2026-10-15T12:00:00Z"), at("2026-10-17T12:00:00Z"), LAGOS, NIGHT);
    expect(nights.map((n) => [n.start.toISOString(), n.end.toISOString()])).toEqual([
      ["2026-10-15T18:00:00.000Z", "2026-10-16T05:00:00.000Z"],
      ["2026-10-16T18:00:00.000Z", "2026-10-17T05:00:00.000Z"],
    ]);
    // Starting in the middle of the night includes the rest of that night.
    const fromMidnight = nightIntervals(at("2026-10-15T23:00:00Z"), at("2026-10-16T02:00:00Z"), LAGOS, NIGHT);
    expect(fromMidnight.map((n) => [n.start.toISOString(), n.end.toISOString()])).toEqual([
      ["2026-10-15T23:00:00.000Z", "2026-10-16T02:00:00.000Z"],
    ]);
  });

  it("knows when it is night in Lagos", () => {
    expect(isNight(at("2026-10-15T17:59:00Z"), LAGOS, NIGHT)).toBe(false); // 18:59
    expect(isNight(at("2026-10-15T18:00:00Z"), LAGOS, NIGHT)).toBe(true); // 19:00
    expect(isNight(at("2026-10-16T04:59:00Z"), LAGOS, NIGHT)).toBe(true); // 05:59
    expect(isNight(at("2026-10-16T05:00:00Z"), LAGOS, NIGHT)).toBe(false); // 06:00
  });
});
