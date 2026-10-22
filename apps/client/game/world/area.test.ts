import { describe, expect, it } from "vitest";
import { AREA_CELL_METRES, ChunkIndex, DRAW_REACH, MODEL_REACH, areaBox, areaCell, pointBox, splitByDetail } from "./area";
import { roadSurface } from "./roads";

const building = (id: string, x: number, z: number) => ({ id, x, z, halfWidth: 4, halfDepth: 3 });

describe("areaCell", () => {
  it("gives the centre of the cell a point is in, the same anywhere inside it", () => {
    expect(areaCell({ x: 1, z: 1 })).toEqual({ x: AREA_CELL_METRES / 2, z: AREA_CELL_METRES / 2 });
    expect(areaCell({ x: 15.9, z: 0.1 })).toEqual(areaCell({ x: 0.1, z: 15.9 }));
    expect(areaCell({ x: -0.1, z: 0 })).toEqual({ x: -AREA_CELL_METRES / 2, z: AREA_CELL_METRES / 2 });
  });
});

describe("areaBox", () => {
  it("reaches far ahead (north) and only a little behind, plus half a cell all round", () => {
    const box = areaBox({ x: 0, z: 0 }, DRAW_REACH);
    const margin = AREA_CELL_METRES / 2;
    expect(box.z - box.halfDepth).toBe(-DRAW_REACH.ahead - margin); // north edge
    expect(box.z + box.halfDepth).toBe(DRAW_REACH.behind + margin); // south edge
    expect(box.halfWidth).toBe(DRAW_REACH.side + margin);
  });
});

describe("ChunkIndex", () => {
  it("picks out exactly the things in an area, in their original order", () => {
    const things = Array.from({ length: 400 }, (_, index) => building(`b${index}`, (index % 20) * 30 - 300, Math.floor(index / 20) * 30 - 300));
    const index = new ChunkIndex(things);
    const area = { x: 10, z: -40, halfWidth: 70, halfDepth: 55 };
    const expected = things.filter(
      (thing) => Math.abs(thing.x - area.x) < thing.halfWidth + area.halfWidth && Math.abs(thing.z - area.z) < thing.halfDepth + area.halfDepth,
    );
    expect(index.within(area)).toEqual(expected);
    expect(index.within({ x: 5000, z: 5000, halfWidth: 10, halfDepth: 10 })).toEqual([]);
  });

  it("finds a long thing from any chunk it crosses", () => {
    const wall = { x: 0, z: -300, halfWidth: 300, halfDepth: 0.3 };
    const index = new ChunkIndex([wall]);
    expect(index.within(areaBox({ x: 280, z: -290 }, DRAW_REACH))).toEqual([wall]);
  });

  it("indexes point things by where they stand", () => {
    const index = new ChunkIndex([pointBox({ kind: "palm", x: 5, z: -50 })]);
    expect(index.within(areaBox({ x: 0, z: 0 }, DRAW_REACH))).toHaveLength(1);
    expect(index.within(areaBox({ x: 0, z: -400 }, DRAW_REACH))).toHaveLength(0);
  });
});

describe("splitByDetail", () => {
  it("draws near buildings as models, further ones as boxes, and the far ones not at all", () => {
    const near = building("near", 0, -20);
    const far = building("far", 0, -MODEL_REACH.ahead - 20); // past the models, before the draw edge
    const gone = building("gone", 0, -DRAW_REACH.ahead - 40);
    const split = splitByDetail(new ChunkIndex([near, far, gone]), { x: 0, z: 0 });
    expect(split.models).toEqual([near]);
    expect(split.boxes).toEqual([far]);
  });
});

describe("roadSurface", () => {
  it("makes one upward-facing quad per road, the grain repeating once per road width", () => {
    const surface = roadSurface([
      { x: 0, z: 0, halfWidth: 300, halfDepth: 4, colour: "#4a4a4f" },
      { x: 0, z: 0, halfWidth: 3, halfDepth: 300, colour: "#4a4a4f" },
    ]);
    expect(surface.positions).toHaveLength(2 * 4 * 3);
    expect(surface.indices).toHaveLength(2 * 6);
    // 600 m long and 8 m wide: 75 repeats along it.
    expect(Math.max(...surface.uvs.slice(0, 8))).toBe(75);
    expect(Math.max(...surface.uvs.slice(8, 16))).toBe(100);
    // The second road lies a hair above the first, so their crossing never flickers.
    expect(surface.positions[13]).toBeGreaterThan(surface.positions[1] ?? 0);
    // Every triangle faces up: (b - a) x (c - a) has a positive y.
    for (let triangle = 0; triangle < surface.indices.length / 3; triangle++) {
      const [a, b, c] = [0, 1, 2].map((corner) => surface.indices[triangle * 3 + corner] as number);
      const point = (vertex: number) => ({ x: surface.positions[vertex * 3] ?? 0, z: surface.positions[vertex * 3 + 2] ?? 0 });
      const [pa, pb, pc] = [point(a as number), point(b as number), point(c as number)];
      const upward = (pb.z - pa.z) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.z - pa.z);
      expect(upward).toBeGreaterThan(0);
    }
  });
});
