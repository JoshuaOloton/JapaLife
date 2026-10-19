import { describe, expect, it } from "vitest";
import { GUTTER_VERGE, GUTTER_WIDTH, layOutGutters } from "./gutters";

const road = (x: number, z: number, halfWidth: number, halfDepth: number) => ({ x, z, halfWidth, halfDepth, colour: "#444444" });
const bounds = { halfWidth: 60, halfDepth: 60 };
const lineOffset = 4 + GUTTER_VERGE + GUTTER_WIDTH / 2;

describe("layOutGutters", () => {
  it("runs a gutter along both sides of a lone road, its full length", () => {
    const { gutters, slabs } = layOutGutters([road(0, 0, 60, 4)], bounds);
    expect(gutters).toHaveLength(2);
    expect(gutters.map((g) => g.z).sort()).toEqual([-lineOffset, lineOffset]);
    expect(gutters.every((g) => g.along === "x" && g.halfWidth === 60 && g.halfDepth === GUTTER_WIDTH / 2)).toBe(true);
    expect(slabs).toEqual([]);
  });

  it("stops gutters at a crossing road, with a slab over each end", () => {
    const { gutters, slabs } = layOutGutters([road(0, 0, 60, 4), road(0, 0, 4, 60)], bounds);
    // Two roads, two sides each, split in two by the junction.
    expect(gutters).toHaveLength(8);
    expect(slabs).toHaveLength(8);
    // No gutter runs across the other road.
    for (const gutter of gutters) {
      if (gutter.along === "x") expect(Math.abs(gutter.x) - gutter.halfWidth).toBeGreaterThan(4);
      else expect(Math.abs(gutter.z) - gutter.halfDepth).toBeGreaterThan(4);
    }
  });

  it("keeps gutters inside the district", () => {
    const { gutters } = layOutGutters([road(0, 0, 80, 4)], bounds);
    expect(gutters.every((g) => Math.abs(g.x) + g.halfWidth <= 60)).toBe(true);
  });

  it("ignores a road that does not reach the gutter's line", () => {
    const { gutters } = layOutGutters([road(0, 0, 60, 4), road(30, 40, 4, 10)], bounds);
    const alongX = gutters.filter((g) => g.along === "x");
    expect(alongX).toHaveLength(2);
  });
});
