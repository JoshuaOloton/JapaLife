import type { TrafficSchedule } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import {
  type Lane,
  type TrafficWorld,
  type Vehicle,
  activeShare,
  buildLane,
  createJunctions,
  laneThroughBox,
  pointOnLane,
  projectOnLane,
  roadOverlaps,
  stepTraffic,
} from "./trafficSim";

const FAR_AWAY = { x: 500, z: 500 };
const ALL_OUT = (): number => 1;

function vehicle(lane: Lane, s: number, extra: Partial<Vehicle> = {}): Vehicle {
  return {
    id: Math.floor(Math.random() * 1e9),
    kind: "car",
    lane,
    s,
    speed: 8,
    cruise: 8,
    halfLength: 2,
    halfWidth: 1,
    stopsAtBusStops: false,
    hash: 0.5,
    parked: false,
    pausedUntil: 0,
    served: new Set(),
    ...extra,
  };
}

function world(lanes: Lane[], vehicles: Vehicle[], junctions = 0): TrafficWorld {
  return { lanes, vehicles, junctions: createJunctions(junctions), time: 0 };
}

/** Runs the world for `seconds` in small steps. */
function run(w: TrafficWorld, seconds: number, player = FAR_AWAY, share = ALL_OUT): void {
  for (let t = 0; t < seconds; t += 0.05) stepTraffic(w, 0.05, player, share);
}

describe("lanes", () => {
  const lane = buildLane("east", [{ x: -50, z: 2 }, { x: 50, z: 2 }]);

  it("knows its length, its main direction and where a distance falls", () => {
    expect(lane.length).toBe(100);
    expect(lane.axis).toBe("x");
    expect(pointOnLane(lane, 30)).toEqual({ x: -20, z: 2, heading: Math.PI / 2 });
  });

  it("projects a point onto it", () => {
    expect(projectOnLane(lane, { x: 0, z: 5 })).toEqual({ s: 50, lateral: 3 });
  });

  it("finds where two roads cross, and the stretch of a lane inside", () => {
    const [junction] = roadOverlaps([
      { x: 0, z: 0, halfWidth: 60, halfDepth: 4 },
      { x: 0, z: 0, halfWidth: 4, halfDepth: 60 },
    ]);
    expect(junction).toEqual({ x: 0, z: 0, halfWidth: 4, halfDepth: 4 });
    const through = laneThroughBox(lane, junction!);
    expect(through?.enter).toBeCloseTo(46, 1);
    expect(through?.exit).toBeCloseTo(54, 1);
  });
});

describe("stepTraffic", () => {
  it("drives along at cruising speed", () => {
    const lane = buildLane("east", [{ x: -100, z: 2 }, { x: 100, z: 2 }]);
    const car = vehicle(lane, 10);
    run(world([lane], [car]), 2);
    expect(car.s).toBeCloseTo(26, 0);
  });

  it("parks off the end of its lane and comes back at the start when the start is clear", () => {
    const lane = buildLane("east", [{ x: -20, z: 2 }, { x: 20, z: 2 }]);
    const car = vehicle(lane, 39);
    const w = world([lane], [car]);
    stepTraffic(w, 0.5, FAR_AWAY, ALL_OUT);
    expect(car.parked).toBe(true);
    stepTraffic(w, 0.05, FAR_AWAY, ALL_OUT);
    expect(car.parked).toBe(false);
    expect(car.s).toBe(0);
  });

  it("stays parked while the schedule has fewer vehicles out", () => {
    const lane = buildLane("east", [{ x: -20, z: 2 }, { x: 20, z: 2 }]);
    const car = vehicle(lane, 0, { parked: true, hash: 0.6 });
    run(world([lane], [car]), 1, FAR_AWAY, () => 0.35);
    expect(car.parked).toBe(true);
  });

  it("queues behind the vehicle ahead instead of driving into it", () => {
    const lane = buildLane("east", [{ x: -100, z: 2 }, { x: 100, z: 2 }]);
    const stopped = vehicle(lane, 60, { cruise: 0, speed: 0 });
    const follower = vehicle(lane, 30);
    run(world([lane], [stopped, follower]), 10);
    const gap = stopped.s - stopped.halfLength - (follower.s + follower.halfLength);
    expect(gap).toBeGreaterThanOrEqual(1.5 - 1e-6);
    expect(gap).toBeLessThan(2.5);
  });

  it("stops for the player standing in its path, then moves off when they step aside", () => {
    const lane = buildLane("east", [{ x: -100, z: 2 }, { x: 100, z: 2 }]);
    const car = vehicle(lane, 40);
    const w = world([lane], [car]);
    const inTheRoad = { x: -40, z: 2 }; // at s = 60
    run(w, 6, inTheRoad);
    expect(car.speed).toBe(0);
    expect(car.s + car.halfLength).toBeLessThan(60 - 0.4);
    run(w, 2, FAR_AWAY);
    expect(car.speed).toBeGreaterThan(0);
  });

  it("slows over a speed bump", () => {
    const lane = buildLane("east", [{ x: -100, z: 2 }, { x: 100, z: 2 }]);
    lane.bumps.push(50);
    const car = vehicle(lane, 30);
    const w = world([lane], [car]);
    let slowest = car.speed;
    for (let t = 0; t < 9; t += 0.05) {
      stepTraffic(w, 0.05, FAR_AWAY, ALL_OUT);
      slowest = Math.min(slowest, car.speed);
    }
    expect(slowest).toBeLessThanOrEqual(2 + 1e-6);
    expect(car.s).toBeGreaterThan(55); // and gets over it
  });

  it("lets one direction through the junction at a time", () => {
    const east = buildLane("east", [{ x: -50, z: 2 }, { x: 50, z: 2 }]);
    const north = buildLane("north", [{ x: 2, z: 50 }, { x: 2, z: -50 }]);
    const box = { x: 0, z: 0, halfWidth: 4, halfDepth: 4 };
    for (const lane of [east, north]) lane.junctions.push({ index: 0, ...laneThroughBox(lane, box)! });
    const a = vehicle(east, 40);
    const b = vehicle(north, 40);
    const w = world([east, north], [a, b], 1);
    let both = 0;
    for (let t = 0; t < 6; t += 0.05) {
      stepTraffic(w, 0.05, FAR_AWAY, ALL_OUT);
      const inBox = (v: Vehicle): boolean => {
        const p = pointOnLane(v.lane, v.s);
        return Math.abs(p.x) < 4 + v.halfLength && Math.abs(p.z) < 4 + v.halfLength && w.junctions[0]!.inside.has(v.id);
      };
      if (inBox(a) && inBox(b)) both++;
    }
    expect(both).toBe(0);
    expect(a.s).toBeGreaterThan(60); // both got through in the end
    expect(b.s).toBeGreaterThan(60);
  });

  it("pauses a danfo at its bus stop, once", () => {
    const lane = buildLane("north", [{ x: 2, z: 50 }, { x: 2, z: -50 }]);
    lane.stops.push({ at: 30, seconds: 5 });
    const danfo = vehicle(lane, 10, { stopsAtBusStops: true });
    const w = world([lane], [danfo]);
    run(w, 6);
    expect(danfo.s).toBeCloseTo(30, 0);
    run(w, 5);
    expect(danfo.s).toBeGreaterThan(35);
  });
});

describe("activeShare", () => {
  const schedule: TrafficSchedule = {
    dayShare: 0.8,
    nightShare: 0.35,
    rushShare: 1,
    rushHours: [{ from: 7, to: 9 }, { from: 17, to: 20 }],
    quietFrom: 22,
    quietUntil: 5,
  };

  it("is quiet late at night, busy by day, and brings every danfo out at rush hour", () => {
    expect(activeShare(schedule, 2, true)).toBe(0.35);
    expect(activeShare(schedule, 23.5, false)).toBe(0.35);
    expect(activeShare(schedule, 12, true)).toBe(0.8);
    expect(activeShare(schedule, 8, true)).toBe(1);
    expect(activeShare(schedule, 8, false)).toBe(0.8);
    expect(activeShare(schedule, 18, true)).toBe(1);
  });
});
