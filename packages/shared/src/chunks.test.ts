import { describe, expect, it } from "vitest";
import {
  CHUNK_METRES,
  chunkKey,
  chunkOf,
  chunksAround,
  districtHeader,
  isRoadProp,
  splitIntoChunks,
  withinRing,
} from "./chunks";
import type { DistrictLayout } from "./content";

const road = { x: 0, z: 0, halfWidth: 300, halfDepth: 4, colour: "#4a4a4f" };

function layout(): DistrictLayout {
  return {
    id: "test",
    name: "Test",
    halfWidth: 300,
    halfDepth: 300,
    spawn: { x: 0, z: 0 },
    interactRadius: 3,
    interactables: [{ id: "home", label: "Home", kind: "home", position: { x: 10, z: 10 } }],
    roads: [road],
    buildings: [
      { id: "a", name: "A", x: 10, z: -20, halfWidth: 4, halfDepth: 3, height: 3, colour: "#ffffff", rotation: 0, scale: 1 },
      { id: "b", name: "B", x: -100, z: 150, halfWidth: 4, halfDepth: 3, height: 3, colour: "#ffffff", model: "flats", rotation: 0, scale: 5 },
      { id: "c", name: "C", x: 70, z: -20, halfWidth: 4, halfDepth: 3, height: 3, colour: "#ffffff", model: "flats", rotation: 0, scale: 5 },
    ],
    props: [
      { kind: "speed-bump", x: 20, z: 0, rotation: 0 },
      { kind: "generator", x: 20, z: 10, rotation: 0 },
    ],
    npcs: [],
    landmarks: [],
    models: { flats: { file: "buildings/flats.glb", halfWidth: 1, halfDepth: 0.65, height: 2.25, triangles: 10, bytes: 10 } },
    propKinds: {},
    characters: {} as DistrictLayout["characters"],
    vehicles: { schedule: {} as DistrictLayout["vehicles"]["schedule"], kinds: {} },
  };
}

describe("chunkOf", () => {
  it("puts a point in the chunk its coordinates fall in, negatives included", () => {
    expect(chunkOf({ x: 0, z: 0 })).toEqual({ cx: 0, cz: 0 });
    expect(chunkOf({ x: CHUNK_METRES - 0.01, z: -0.01 })).toEqual({ cx: 0, cz: -1 });
    expect(chunkOf({ x: -CHUNK_METRES, z: CHUNK_METRES })).toEqual({ cx: -1, cz: 1 });
  });
});

describe("chunksAround", () => {
  it("lists the square around a chunk, the centre first", () => {
    const around = chunksAround({ cx: 3, cz: -2 }, 2);
    expect(around).toHaveLength(25);
    expect(around[0]).toEqual({ cx: 3, cz: -2 });
    expect(new Set(around.map(chunkKey)).size).toBe(25);
    expect(around.every((chunk) => withinRing(chunk, { cx: 3, cz: -2 }, 2))).toBe(true);
  });
});

describe("splitIntoChunks", () => {
  it("puts every building and prop in exactly one chunk, by its centre, and leaves road furniture out", () => {
    const chunks = splitIntoChunks(layout());
    const buildings = [...chunks.values()].flatMap((chunk) => chunk.buildings.map((b) => b.id));
    expect(buildings.sort()).toEqual(["a", "b", "c"]);
    expect(chunks.get(chunkKey(chunkOf({ x: 70, z: -20 })))?.buildings.map((b) => b.id)).toEqual(["c"]);
    // The speed bump lies on the road, so it travels in the header instead.
    expect([...chunks.values()].flatMap((chunk) => chunk.props.map((p) => p.kind))).toEqual(["generator"]);
  });
});

describe("districtHeader", () => {
  it("leaves the chunked things out, but keeps road furniture, the NPCs, the model counts and the outline map", () => {
    const header = districtHeader(layout());
    expect("buildings" in header).toBe(false);
    expect("props" in header).toBe(false);
    expect(header.npcs).toEqual([]);
    expect(header.roadProps.map((p) => p.kind)).toEqual(["speed-bump"]);
    expect(header.buildingModels).toEqual({ flats: 2 });
    expect(header.mapBuildings).toEqual([10, -20, 4, 3, -100, 150, 4, 3, 70, -20, 4, 3]);
    expect(header.interactables).toHaveLength(1);
  });

  it("tells road furniture from things beside the road", () => {
    expect(isRoadProp({ x: 100, z: 3.9 }, [road])).toBe(true);
    expect(isRoadProp({ x: 100, z: 5 }, [road])).toBe(false);
  });
});
