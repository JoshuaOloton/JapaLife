import { describe, expect, it } from "vitest";
import type { Interactable } from "@japalife/shared";
import { formatCountdown, formatGameClock, formatNaira } from "./format";

describe("formatGameClock", () => {
  it("counts days from the player's first day in Lagos and shows Lagos time", () => {
    expect(formatGameClock(Date.parse("2026-10-15T08:05:00Z"), "2026-10-15", "Africa/Lagos")).toBe("Day 1 · 9:05 AM");
    expect(formatGameClock(Date.parse("2026-10-26T18:45:00Z"), "2026-10-15", "Africa/Lagos")).toBe("Day 12 · 7:45 PM");
  });

  it("turns the day over at midnight Lagos time, not UTC", () => {
    // 23:30 UTC is 00:30 the next day in Lagos.
    expect(formatGameClock(Date.parse("2026-10-15T23:30:00Z"), "2026-10-15", "Africa/Lagos")).toBe("Day 2 · 12:30 AM");
  });
});
import { nearestPlace } from "./nearby";

describe("formatNaira", () => {
  it("shows whole naira without kobo", () => {
    expect(formatNaira(2_000_000)).toBe("₦20,000");
  });

  it("shows kobo when there are some, e.g. after a price rise", () => {
    expect(formatNaira(437_550)).toBe("₦4,375.50");
  });
});

describe("nearestPlace", () => {
  const place = (id: string, x: number): Interactable => ({ id, label: id, kind: "home", position: { x, z: 0 } });

  it("picks the closest place in range, and nothing when none is", () => {
    const places = [place("far", 2.9), place("near", 1)];
    expect(nearestPlace({ x: 0, z: 0 }, places, 3)?.id).toBe("near");
    expect(nearestPlace({ x: -5, z: 0 }, places, 3)).toBeUndefined();
  });
});

describe("formatCountdown", () => {
  it("uses days and hours for long waits", () => {
    expect(formatCountdown((29 * 24 + 23) * 3_600_000 + 59_000)).toBe("29d 23h");
  });

  it("uses hours and minutes under a day", () => {
    expect(formatCountdown(5 * 3_600_000 + 3 * 60_000)).toBe("5h 03m");
  });

  it("uses minutes and seconds under an hour, and never goes negative", () => {
    expect(formatCountdown(12 * 60_000 + 34_000)).toBe("12:34");
    expect(formatCountdown(-5000)).toBe("0:00");
  });
});
