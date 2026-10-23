import { describe, expect, it } from "vitest";
import type { Road } from "./content";
import { routeBetween } from "./roadGraph";

const colour = "#4a4a4f";
/** An east-west main road through the middle and a north-south one crossing it at x = 0. */
const ew: Road = { x: 0, z: 0, halfWidth: 100, halfDepth: 4, colour, class: "main" };
const ns: Road = { x: 0, z: 0, halfWidth: 4, halfDepth: 100, colour, class: "main" };

const onSomeRoad = (roads: readonly Road[], point: { x: number; z: number }): boolean =>
  roads.some((road) => Math.abs(point.x - road.x) <= road.halfWidth && Math.abs(point.z - road.z) <= road.halfDepth);

describe("routeBetween", () => {
  it("walks straight along a road on its right-hand side", () => {
    const route = routeBetween([ew], { x: -50, z: 0 }, { x: 50, z: 0 })!;
    // Heading east, the right hand is south (+z): 3.2 m in from the centre of an 8 m road.
    const middle = route.points.slice(1, -1);
    expect(middle.every((point) => point.z === 3.2)).toBe(true);
    expect(route.length).toBeCloseTo(100 + 2 * 3.2, 6);
  });

  it("turns at a junction, cornering on the right-hand side inside it", () => {
    const route = routeBetween([ew, ns], { x: -50, z: 0 }, { x: 0, z: -50 })!;
    // East along the main road, then north up the crossing one.
    expect(route.points).toContainEqual({ x: 3.2, z: 3.2 });
    expect(route.points.at(-1)).toEqual({ x: 0, z: -50 });
    for (const point of route.points.slice(1, -1)) expect(onSomeRoad([ew, ns], point)).toBe(true);
  });

  it("takes the shorter of two ways round", () => {
    // A block with roads on all four sides; going from its west side to its south-east corner.
    const north: Road = { x: 0, z: -50, halfWidth: 54, halfDepth: 3, colour };
    const south: Road = { x: 0, z: 50, halfWidth: 54, halfDepth: 3, colour };
    const west: Road = { x: -50, z: 0, halfWidth: 3, halfDepth: 54, colour };
    const east: Road = { x: 50, z: 0, halfWidth: 3, halfDepth: 54, colour };
    const route = routeBetween([north, south, west, east], { x: -50, z: 30 }, { x: 50, z: 50 })!;
    // South then east (120 m), not north, east and south (about 280 m).
    expect(route.length).toBeLessThan(140);
    expect(route.points.every((point) => point.z > -40)).toBe(true);
  });

  it("walks down the middle of a narrow lane", () => {
    const lane: Road = { x: 0, z: 20, halfWidth: 60, halfDepth: 2, colour, class: "lane" };
    const route = routeBetween([lane], { x: -40, z: 20 }, { x: 40, z: 20 })!;
    expect(route.points.every((point) => point.z === 20)).toBe(true);
  });

  it("joins the nearest road from wherever the ends are", () => {
    const route = routeBetween([ew, ns], { x: -30, z: 25 }, { x: 30, z: 25 })!;
    expect(route.points[0]).toEqual({ x: -30, z: 25 });
    expect(route.points.at(-1)).toEqual({ x: 30, z: 25 });
    expect(route.points.slice(1, -1).every((point) => onSomeRoad([ew], point))).toBe(true);
  });

  it("has no route without roads", () => {
    expect(routeBetween([], { x: 0, z: 0 }, { x: 10, z: 0 })).toBeUndefined();
  });
});
