import { describe, expect, it } from "vitest";
import { CURRENCIES, POSITION_UPDATE_HZ } from "./constants";

describe("constants", () => {
  it("launches with exactly NGN, GBP and CAD", () => {
    expect(CURRENCIES).toEqual(["NGN", "GBP", "CAD"]);
  });

  it("keeps position updates within 10-20 Hz", () => {
    expect(POSITION_UPDATE_HZ).toBeGreaterThanOrEqual(10);
    expect(POSITION_UPDATE_HZ).toBeLessThanOrEqual(20);
  });
});
