import type { Road } from "@japalife/shared";
import { describe, expect, it } from "vitest";
import { MoveInput } from "./input";
import { LabelSpace, fitScale, keepInside, screenToWorld, worldToScreen } from "./map/mapPaint";
import { type RouteEnd, RouteFollower, crossesBuilding, insideBuilding, planRoute } from "./route";
import { ribbonGeometry } from "./world/ribbon";

const road: Road = { x: 0, z: 0, halfWidth: 100, halfDepth: 4, colour: "#4a4a4f", class: "main" };

describe("planRoute", () => {
  // Outlines as the header has them: x, z, halfWidth, halfDepth, height, roof tone.
  const noWater = { roads: [road], water: [] };

  it("ends at the road beside a building rather than inside it", () => {
    const shop = [40, 12, 5, 5, 3, 0]; // a shop south of the road, 7 to 17 m off its centre
    const intoTheShop = planRoute({ ...noWater, mapBuildings: shop }, { x: -40, z: 0 }, { x: 40, z: 12 })!;
    expect(intoTheShop.points.at(-1)).not.toEqual({ x: 40, z: 12 });
    const toOpenGround = planRoute({ ...noWater, mapBuildings: shop }, { x: -40, z: 0 }, { x: 60, z: 12 })!;
    expect(toOpenGround.points.at(-1)).toEqual({ x: 60, z: 12 });
  });

  it("ends at the road when a building stands between it and the spot (a yard behind a shop)", () => {
    const shop = [40, 12, 5, 4, 3, 0]; // from 8 to 16 m south of the road's centre
    const behindTheShop = planRoute({ ...noWater, mapBuildings: shop }, { x: -40, z: 0 }, { x: 40, z: 25 })!;
    expect(behindTheShop.points.at(-1)).not.toEqual({ x: 40, z: 25 });
    expect(crossesBuilding(shop, { x: 40, z: 3 }, { x: 40, z: 25 })).toBe(true);
    expect(crossesBuilding(shop, { x: 50, z: 3 }, { x: 50, z: 25 })).toBe(false);
  });

  it("ends at the road when water lies between it and the spot", () => {
    const pond = { id: "pond", kind: "pond" as const, x: 40, z: 12, halfWidth: 5, halfDepth: 4 };
    const acrossThePond = planRoute({ roads: [road], water: [pond], mapBuildings: [] }, { x: -40, z: 0 }, { x: 40, z: 25 })!;
    expect(acrossThePond.points.at(-1)).not.toEqual({ x: 40, z: 25 });
  });

  it("knows whether a point is inside any outline", () => {
    expect(insideBuilding([0, 0, 2, 2, 3, 0, 10, 10, 1, 1, 3, 0], { x: 10.5, z: 9.5 })).toBe(true);
    expect(insideBuilding([0, 0, 2, 2, 3, 0], { x: 3, z: 0 })).toBe(false);
  });
});

describe("RouteFollower", () => {
  const points = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: -10 }];

  it("steers toward each waypoint in turn, then arrives", () => {
    const follower = new RouteFollower(points);
    expect(follower.steer({ x: 0, z: 0 }, 0)).toEqual({ x: 1, z: 0 });
    // Close to the corner: on to the next leg, heading (almost straight) north.
    const turned = follower.steer({ x: 9.5, z: 0 }, 100) as { x: number; z: number };
    expect(turned.z).toBeLessThan(-0.99);
    expect(follower.steer({ x: 10, z: -9.5 }, 200)).toBe("arrived");
  });

  it("gives up when the player stops getting closer (something in the way)", () => {
    const follower = new RouteFollower(points);
    follower.steer({ x: 2, z: 0 }, 0);
    expect(follower.steer({ x: 2.1, z: 0 }, 1600)).toBe("stuck");
  });

  it("gives up when pushed along a wall instead of toward the waypoint", () => {
    // The waypoint is straight north; the player slides east along a wall, barely closer.
    const follower = new RouteFollower([{ x: 0, z: 0 }, { x: 0, z: -20 }]);
    follower.steer({ x: 0, z: -5 }, 0);
    expect(follower.steer({ x: 2, z: -5.1 }, 1600)).toBe("stuck");
  });
});

describe("walking a route with MoveInput", () => {
  it("walks by itself until the player touches the controls", () => {
    const input = new MoveInput();
    const ends: RouteEnd[] = [];
    input.setAutopilot(new RouteFollower([{ x: 0, z: 0 }, { x: 0, z: -20 }]), (end) => ends.push(end));
    expect(input.direction({ x: 0, z: 0 }, 0)).toEqual({ x: 0, z: -1 });
    input.setJoystick({ x: 1, z: 0 });
    expect(input.direction({ x: 0, z: -1 }, 100).x).toBeGreaterThan(0);
    expect(ends).toEqual(["cancelled"]);
    expect(input.walkingRoute).toBe(false);
  });
});

describe("the route on the street", () => {
  it("is one upward-facing quad per leg", () => {
    const { positions, indices } = ribbonGeometry([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: -10 }]);
    expect(positions).toHaveLength(2 * 4 * 3);
    expect(indices).toHaveLength(2 * 6);
    for (let triangle = 0; triangle < indices.length / 3; triangle++) {
      const [a, b, c] = [0, 1, 2].map((corner) => indices[triangle * 3 + corner] as number) as [number, number, number];
      const p = (vertex: number) => ({ x: positions[vertex * 3] ?? 0, z: positions[vertex * 3 + 2] ?? 0 });
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      expect((pb.z - pa.z) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.z - pa.z)).toBeGreaterThan(0);
    }
  });
});

describe("the map's view", () => {
  it("turns screen pixels into the world and back, north up", () => {
    const view = { x: 100, z: -50, scale: 2 };
    expect(worldToScreen(view, 400, 300, { x: 100, z: -50 })).toEqual({ x: 200, y: 150 });
    expect(worldToScreen(view, 400, 300, { x: 100, z: -60 }).y).toBe(130); // north is up the screen
    const back = screenToWorld(view, 400, 300, 260, 90);
    expect(worldToScreen(view, 400, 300, back)).toEqual({ x: 260, y: 90 });
  });

  // A 600 m district on a 400 x 800 portrait phone.
  const yaba = { halfWidth: 300, halfDepth: 300 };

  it("zooms out only until the district fills the screen's width", () => {
    const scale = fitScale(yaba, 400, 800);
    expect(scale).toBeCloseTo(400 / 630, 9); // the width is the tighter side; 15 m of ground each side
  });

  it("will not be dragged off the district, and centres it when it is narrower than the screen", () => {
    const dragged = { x: 1000, z: -1000, scale: 1.4 };
    keepInside(dragged, yaba, 400, 800);
    // The screen's right edge sits 15 m past the district's east edge, its top 15 m past the north edge.
    expect(dragged.x + 200 / 1.4).toBeCloseTo(315, 9);
    expect(dragged.z - 400 / 1.4).toBeCloseTo(-315, 9);

    const zoomedOut = { x: 50, z: 80, scale: fitScale(yaba, 400, 800) };
    keepInside(zoomedOut, yaba, 400, 800);
    expect(zoomedOut.x).toBeCloseTo(0, 9); // the whole width fits: centred
    expect(Math.abs(zoomedOut.z)).toBeLessThanOrEqual(80); // the height still has room to pan
  });
});

describe("label space", () => {
  it("lets a label in only where nothing is yet", () => {
    const space = new LabelSpace();
    expect(space.claim({ left: 0, top: 0, right: 100, bottom: 20 })).toBe(true);
    expect(space.claim({ left: 90, top: 10, right: 150, bottom: 30 })).toBe(false); // overlaps the first
    expect(space.claim({ left: 100, top: 0, right: 150, bottom: 20 })).toBe(true); // just touching is fine
  });
});
