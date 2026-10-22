import { CHUNK_KEEP_RING, type ChunkContent, type DistrictHeader } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { ChunkStore, type DistrictRoom, headerLayout, withChunks } from "./connection";
import { roomFor } from "./world/area";

const room = { onMessage: () => () => undefined } as unknown as DistrictRoom;

function chunk(cx: number, cz: number): ChunkContent {
  return {
    cx,
    cz,
    buildings: [{ id: `b${cx},${cz}`, name: "B", x: cx * 64 + 10, z: cz * 64 + 10, halfWidth: 3, halfDepth: 3, height: 3, colour: "#ffffff", rotation: 0, scale: 1 }],
    props: [{ kind: "generator", x: cx * 64 + 20, z: cz * 64 + 20, rotation: 0 }],
  };
}

describe("ChunkStore", () => {
  it("keeps the chunks it is sent, and drops those too far from the latest centre", () => {
    const store = new ChunkStore(room);
    store.receive({ centre: { cx: 0, cz: 0 }, chunks: [chunk(0, 0), chunk(1, 0), chunk(-2, 0)] });
    expect(store.chunks()).toHaveLength(3);
    const before = store.version;
    // Walked far east: the chunk at -2 is now more than the keep ring away.
    store.receive({ centre: { cx: CHUNK_KEEP_RING - 1, cz: 0 }, chunks: [chunk(CHUNK_KEEP_RING + 1, 0)] });
    expect(store.chunks().map((c) => c.cx).sort((a, b) => a - b)).toEqual([0, 1, CHUNK_KEEP_RING + 1]);
    expect(store.version).toBeGreaterThan(before);
  });

  it("tells its listener when the chunks change", () => {
    const store = new ChunkStore(room);
    let calls = 0;
    const stop = store.subscribe(() => calls++);
    store.receive({ centre: { cx: 0, cz: 0 }, chunks: [chunk(0, 0)] });
    stop();
    store.receive({ centre: { cx: 0, cz: 0 }, chunks: [chunk(1, 0)] });
    expect(calls).toBe(1);
  });
});

describe("the loaded district", () => {
  const header = {
    id: "yaba",
    roads: [],
    roadProps: [{ kind: "speed-bump", x: 0, z: 0, rotation: 0 }],
    buildingModels: { flats: 3 },
    mapBuildings: [1, 2, 3, 4],
  } as unknown as DistrictHeader;

  it("starts from the header with only its road furniture, then adds the loaded chunks' things", () => {
    const base = headerLayout(header);
    expect(base.buildings).toEqual([]);
    expect(base.props.map((p) => p.kind)).toEqual(["speed-bump"]);
    expect("mapBuildings" in base).toBe(false);
    const loaded = withChunks(base, [chunk(0, 0), chunk(1, 0)]);
    expect(loaded.buildings.map((b) => b.id)).toEqual(["b0,0", "b1,0"]);
    expect(loaded.props.map((p) => p.kind)).toEqual(["speed-bump", "generator", "generator"]);
    expect(loaded.roads).toBe(base.roads); // the same roads, so nothing drawn from them rebuilds
  });
});

describe("roomFor", () => {
  it("grows an instanced mesh in doubling steps and never shrinks it", () => {
    expect(roomFor(0)).toBe(64);
    expect(roomFor(65)).toBe(128);
    expect(roomFor(300, 128)).toBe(512);
    expect(roomFor(10, 512)).toBe(512);
  });
});
