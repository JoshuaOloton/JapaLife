import { describe, expect, it } from "vitest";
import { HAIR_PATTERN_SIZE, hairPatternPixels } from "./hairPatterns";

/** Share of pixels that are hair (opaque) in a region of the pattern. */
function coverage(pixels: Uint8Array, inRegion: (u: number, v: number) => boolean): number {
  let hair = 0;
  let total = 0;
  for (let row = 0; row < HAIR_PATTERN_SIZE; row++) {
    for (let column = 0; column < HAIR_PATTERN_SIZE; column++) {
      const u = (column + 0.5) / HAIR_PATTERN_SIZE;
      const v = (row + 0.5) / HAIR_PATTERN_SIZE;
      if (!inRegion(u, v)) continue;
      total++;
      if ((pixels[(row * HAIR_PATTERN_SIZE + column) * 4 + 3] ?? 0) > 0) hair++;
    }
  }
  return hair / total;
}

describe("hairPatternPixels", () => {
  it("paints the same pattern every time", () => {
    expect(hairPatternPixels("fade")).toEqual(hairPatternPixels("fade"));
    expect(hairPatternPixels("cornrows")).toEqual(hairPatternPixels("cornrows"));
  });

  it("gives cornrows partings of bare scalp between the braids", () => {
    const pixels = hairPatternPixels("cornrows");
    // Down the middle of a braid (row 4 of 9) there is hair; along a parting there is none.
    const braid = (4 + 0.5) / 9;
    const parting = 4 / 9;
    expect(coverage(pixels, (u) => Math.abs(u - braid) < 0.004)).toBe(1);
    expect(coverage(pixels, (u) => Math.abs(u - parting) < 0.004)).toBe(0);
  });

  it("keeps a fade full on top and thins it out toward the sides", () => {
    const pixels = hairPatternPixels("fade");
    const crown = coverage(pixels, (u, v) => Math.hypot(u - 0.5, v - 0.5) < 0.2);
    const middle = coverage(pixels, (u, v) => Math.abs(Math.hypot(u - 0.5, v - 0.5) - 0.36) < 0.03);
    const edge = coverage(pixels, (u, v) => Math.hypot(u - 0.5, v - 0.5) > 0.48);
    expect(crown).toBe(1);
    expect(middle).toBeGreaterThan(0.2);
    expect(middle).toBeLessThan(0.8);
    expect(edge).toBe(0);
  });
});
