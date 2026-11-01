import { describe, expect, it } from "vitest";
import { waterSlabs, withoutWater } from "./waterShapes";

// A canal running north-south, bridged by one east-west road.
const canal = { x: 0, z: 0, halfWidth: 4, halfDepth: 50 };
const road = { x: 0, z: 0, halfWidth: 100, halfDepth: 3 };

describe("waterSlabs", () => {
  const slabs = waterSlabs([canal], [road]);

  it("lines each side of the canal but not where the bridge continues it", () => {
    const lips = slabs.filter((slab) => slab.height < 0.5);
    // Two pieces, each with its far end, west and east lips: none across the bridge.
    expect(lips).toHaveLength(6);
    expect(lips.some((lip) => Math.abs(lip.z) < 3.5 && lip.halfWidth > lip.halfDepth)).toBe(false);
  });

  it("puts a parapet along both edges of the bridge, a little longer than the canal is wide", () => {
    const parapets = slabs.filter((slab) => slab.height >= 0.5);
    expect(parapets).toHaveLength(2);
    expect(parapets.map((p) => Math.sign(p.z)).sort()).toEqual([-1, 1]);
    for (const parapet of parapets) {
      expect(Math.abs(parapet.z)).toBeGreaterThanOrEqual(road.halfDepth);
      expect(parapet.halfWidth).toBeGreaterThan(canal.halfWidth);
    }
  });

  it("closes a pond on all four sides", () => {
    const pond = { x: 50, z: 50, halfWidth: 9, halfDepth: 6 };
    expect(waterSlabs([pond], [road])).toHaveLength(4);
  });
});

describe("withoutWater", () => {
  it("cuts a gutter where it runs over the canal, keeping its colour and height", () => {
    const gutter = { x: 0, z: 4, halfWidth: 100, halfDepth: 0.3, height: 0.03, colour: "#2a3229" };
    const parts = withoutWater([gutter], [canal], [road]);
    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.colour === gutter.colour && part.height === gutter.height)).toBe(true);
    expect(parts.every((part) => Math.abs(part.x) - part.halfWidth >= canal.halfWidth - 1e-9)).toBe(true);
  });
});
