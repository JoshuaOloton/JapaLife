import { describe, expect, it } from "vitest";
import { type Box, isBlocked, moveWithCollisions, obstacleGrid, reachableTargets } from "./collision";
import { PLAYER_RADIUS } from "./constants";
import { SpatialGrid } from "./spatialGrid";

/** mulberry32: a small seeded random, so every run tests the same layouts. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The old way: test every box. The grid must always give the same answer. */
function blockedByScan(point: { x: number; z: number }, boxes: readonly Box[], radius: number): boolean {
  return boxes.some(
    (box) => Math.abs(point.x - box.x) < box.halfWidth + radius && Math.abs(point.z - box.z) < box.halfDepth + radius,
  );
}

/** Boxes of every size, from a pole to a block longer than several cells, some far outside the rest. */
function randomBoxes(random: () => number, count: number, half: number): Box[] {
  return Array.from({ length: count }, () => ({
    x: (random() * 2 - 1) * half,
    z: (random() * 2 - 1) * half,
    halfWidth: random() < 0.1 ? random() * 30 : 0.1 + random() * 5,
    halfDepth: random() < 0.1 ? random() * 30 : 0.1 + random() * 5,
  }));
}

/**
 * A stand-in for a 600 m Yaba: building plots on a street grid, a pole and a
 * generator by each, and roads left open between the blocks.
 */
function cityLayout(half: number): { boxes: Box[]; places: { x: number; z: number }[] } {
  const random = seeded(7);
  const boxes: Box[] = [];
  const places: { x: number; z: number }[] = [];
  const block = 40; // a block and its road
  for (let x = -half + block / 2; x < half; x += block) {
    for (let z = -half + block / 2; z < half; z += block) {
      for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]] as const) {
        boxes.push({ x: x + dx, z: z + dz, halfWidth: 5 + random() * 2, halfDepth: 5 + random() * 2 });
      }
      boxes.push({ x: x + 16, z: z + 16, halfWidth: 0.15, halfDepth: 0.15 });
      boxes.push({ x: x - 16, z: z + 16, halfWidth: 0.6, halfDepth: 0.4 });
      places.push({ x: x + 18, z: z });
    }
  }
  return { boxes, places };
}

describe("SpatialGrid", () => {
  it("gives exactly the answer of testing every box, on random layouts", () => {
    const random = seeded(42);
    for (let layout = 0; layout < 20; layout++) {
      const boxes = randomBoxes(random, 200, 100);
      const grid = obstacleGrid(boxes);
      for (let probe = 0; probe < 2000; probe++) {
        const point = { x: (random() * 2 - 1) * 130, z: (random() * 2 - 1) * 130 };
        const radius = random() < 0.5 ? PLAYER_RADIUS : random() * 3;
        expect(isBlocked(point, grid, radius)).toBe(blockedByScan(point, boxes, radius));
      }
    }
  });

  it("agrees with the scan right at a wall's face, where rounding could slip", () => {
    const wall: Box = { x: 7.9999999, z: 0, halfWidth: 0.0000001, halfDepth: 8 }; // its face sits on a cell edge
    const grid = obstacleGrid([wall]);
    for (const x of [7.6, 7.6 - 1e-12, 7.6 + 1e-12, 8.4, 8.4 + 1e-12, 16, 0]) {
      expect(isBlocked({ x, z: 0 }, grid)).toBe(blockedByScan({ x, z: 0 }, [wall], PLAYER_RADIUS));
    }
  });

  it("walks the same path as testing every box", () => {
    const random = seeded(3);
    const boxes = randomBoxes(random, 300, 80);
    const grid = obstacleGrid(boxes);
    const bounds = { halfWidth: 100, halfDepth: 100 };
    let position = { x: 0, z: 0 };
    for (let step = 0; step < 500; step++) {
      const from = position;
      position = moveWithCollisions(position, { x: random() * 2 - 1, z: random() * 2 - 1 }, grid, bounds);
      expect(blockedByScan(position, boxes, PLAYER_RADIUS) && !blockedByScan(from, boxes, PLAYER_RADIUS)).toBe(false);
    }
  });

  it("lists each nearby box once, even one spanning many cells", () => {
    const long: Box = { x: 0, z: 0, halfWidth: 50, halfDepth: 1 };
    const pole: Box = { x: 3, z: 3, halfWidth: 0.1, halfDepth: 0.1 };
    const far: Box = { x: 90, z: 90, halfWidth: 1, halfDepth: 1 };
    const grid = new SpatialGrid([long, pole, far]);
    expect(grid.near(0, 0, 20, 20)).toEqual([long, pole]);
    expect(grid.near(90, 90, 1, 1)).toEqual([far]);
    expect(grid.size).toBe(3);
  });

  it("finds nothing outside its boxes and copes with being empty", () => {
    const grid = obstacleGrid([{ x: 0, z: 0, halfWidth: 1, halfDepth: 1 }]);
    expect(isBlocked({ x: 500, z: -500 }, grid)).toBe(false);
    expect(isBlocked({ x: 0, z: 0 }, obstacleGrid([]))).toBe(false);
    expect(new SpatialGrid([]).near(0, 0, 10, 10)).toEqual([]);
  });
});

describe("reachableTargets at Big Yaba size", () => {
  it("checks a 600 m district quickly enough for server start", () => {
    const half = 300;
    const { boxes, places } = cityLayout(half);
    const walledOff = { x: -half + 12, z: -half + 12 }; // inside the first plot's building
    const started = Date.now(); // the shared package has no DOM or Node types, so no `performance`
    const reachable = reachableTargets(
      { x: -half + 20, z: -half + 20 }, // on the road between the first blocks
      [...places, walledOff],
      3,
      obstacleGrid(boxes),
      { halfWidth: half, halfDepth: half },
    );
    const seconds = (Date.now() - started) / 1000;
    expect(reachable.slice(0, -1).every(Boolean)).toBe(true);
    expect(reachable.at(-1)).toBe(false);
    expect(seconds).toBeLessThan(2); // about 0.05 s on a laptop; scanning every box took about 2 s
  });
});
