import { describe, expect, it } from "vitest";
import { localHour, skyAt, sunDirection } from "./sky";

describe("skyAt", () => {
  it("is full day at noon and full night at midnight", () => {
    expect(skyAt(12).darkness).toBe(0);
    expect(skyAt(12).sky).toBe("#c4dcea");
    expect(skyAt(0).darkness).toBe(1);
    expect(skyAt(2).sky).toBe("#1a2c50");
  });

  it("is clearly darker at night when NEPA has taken light, and unchanged by a cut in the day", () => {
    const night = skyAt(22);
    const cut = skyAt(22, true);
    expect(cut.hemiIntensity).toBeLessThan(night.hemiIntensity * 0.6);
    expect(cut.sunIntensity).toBeLessThan(night.sunIntensity);
    expect(skyAt(12, true)).toEqual(skyAt(12));
    // At dusk the cut only darkens as far as it is already night.
    expect(skyAt(18.6, true).hemiIntensity).toBeGreaterThan(cut.hemiIntensity);
  });

  it("blends between keyframes", () => {
    const dusk = skyAt(18.6);
    const between = skyAt(19);
    expect(between.darkness).toBeGreaterThan(dusk.darkness);
    expect(between.darkness).toBeLessThan(1);
  });

  it("wraps around midnight without a jump", () => {
    expect(skyAt(23.99)).toEqual(skyAt(24));
    expect(skyAt(24)).toEqual(skyAt(0));
    expect(skyAt(-1)).toEqual(skyAt(23));
  });

  it("puts the sun east in the morning, high at noon, west in the evening", () => {
    expect(sunDirection(7)[0]).toBeGreaterThan(0);
    expect(sunDirection(12.5)[1]).toBeGreaterThan(sunDirection(7)[1]);
    expect(sunDirection(18)[0]).toBeLessThan(0);
  });
});

describe("localHour", () => {
  it("reads Lagos time (UTC+1, no daylight saving)", () => {
    expect(localHour(Date.parse("2026-07-01T18:30:00Z"), "Africa/Lagos")).toBe(19.5);
    expect(localHour(Date.parse("2026-01-01T23:00:00Z"), "Africa/Lagos")).toBe(0);
  });
});
